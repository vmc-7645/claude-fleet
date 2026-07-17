// Contexts — a searchable index over every session transcript, so you can find
// past work by branch / repo / what was actually said. SPEC §5.9, §6.5.
//
// This is deliberately its OWN read path rather than an extension of
// TranscriptMeta. The menu bar reaches readTranscripts() every 60s via
// loadAgents(); hanging ~8MB of message text off that shape would re-introduce
// the worker OOM that 6ae821e just fixed. Search pays a second streaming pass
// (~0.6s over 238 sessions, once) and persists the result, so nothing the menu
// bar touches has to carry the text. SPEC §9.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { eachLine } from "./history";

export interface ContextMessage {
  role: "u" | "a";
  text: string;
}

export interface ContextRecord {
  sessionId: string;
  root: string; // the session's cwd — see firstCwd() below
  repo: string;
  branches: string[]; // every branch the session touched, in first-seen order
  branch: string; // the one it ended on — what the row displays
  title: string;
  turns: number;
  model: string;
  updatedAt: number; // mtime ms
  messages: ContextMessage[];
  // Filled in by the caller from live sources, not by the index:
  live?: boolean;
  state?: string;
}

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const CACHE_DIR = join(homedir(), ".cache", "claude-fleet");
const CACHE_FILE = join(CACHE_DIR, "contexts.json");

// Bump when ContextRecord's shape changes — a stale-shaped cache is discarded
// rather than half-read.
const SCHEMA = 1;

// Transcripts are mostly tool results and file dumps; only ~4.5% of the bytes
// are things a human said or read. Capping each message bounds the index (~4MB
// over 238 sessions) while keeping every message searchable.
const MAX_MESSAGE = 2000;
const MAX_MESSAGES = 400;

// The per-session caps alone only bound a record (~800KB worst case); across a
// long-lived history they'd still multiply — 238 sessions could reach ~190MB in
// theory, and this cache is read back with one JSON.parse, which is the same
// shape of failure as the OOM in 6ae821e. So the index also has a *global* text
// budget. Sessions are indexed newest-first, so if it's ever reached it's the
// OLDEST sessions that fall back to metadata-only — they stay listed and
// filterable by branch/repo, they just aren't full-text searchable.
// (Locally this is nowhere near binding: 237 sessions = 3.6MB, ~15KB each.)
const TEXT_BUDGET = 48 * 1024 * 1024;

interface CacheEntry {
  mtimeMs: number;
  truncated?: boolean; // indexed without message text (budget was spent)
  rec: ContextRecord;
}

interface CacheFile {
  v: number;
  entries: Record<string, CacheEntry>; // transcript path → entry
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(
        (b) =>
          b &&
          (b as { type?: string }).type === "text" &&
          typeof (b as { text?: string }).text === "string",
      )
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();
  }
  return "";
}

// Same rule as history.ts: tool results are written as type:"user" rows, and
// they aren't turns.
function isUserTurn(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some(
      (b) => b && (b as { type?: string }).type !== "tool_result",
    );
  }
  return false;
}

// `withText: false` still yields a fully-formed record (branch, repo, title,
// turns) — it just skips the message bodies, so the row lists and filters
// normally and only free-text search can't reach it.
function parse(
  path: string,
  sessionId: string,
  mtimeMs: number,
  withText: boolean,
): ContextRecord {
  const rec: ContextRecord = {
    sessionId,
    root: "",
    repo: "",
    branches: [],
    branch: "",
    title: "",
    turns: 0,
    model: "",
    updatedAt: mtimeMs,
    messages: [],
  };
  const seen = new Set<string>();

  eachLine(path, (line) => {
    if (!line) return;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }

    // FIRST cwd wins — this is the session root. `cwd` is re-recorded on every
    // row and tracks the *shell's* directory, so a `cd` inside a Bash call
    // rewrites it mid-session (verified: 33 of 237 sessions drift, and 4 end on
    // a directory that no longer exists). Taking the last one would point
    // Resume at a subdirectory, or at nothing.
    if (!rec.root && typeof row.cwd === "string" && row.cwd) {
      rec.root = row.cwd;
      rec.repo = basename(row.cwd) || "?";
    }

    if (typeof row.gitBranch === "string" && row.gitBranch) {
      rec.branch = row.gitBranch;
      if (!seen.has(row.gitBranch)) {
        seen.add(row.gitBranch);
        rec.branches.push(row.gitBranch);
      }
    }

    if (row.type === "ai-title" && typeof row.aiTitle === "string") {
      if (row.sessionId === sessionId || !rec.title) rec.title = row.aiTitle;
    }

    if (row.type === "user") {
      const msg = row.message as { content?: unknown } | undefined;
      // Turns are counted even when text is skipped — the row still reports it.
      if (msg && isUserTurn(msg.content)) {
        rec.turns++;
        if (!withText) return;
        const t = textOf(msg.content);
        if (t && rec.messages.length < MAX_MESSAGES) {
          rec.messages.push({ role: "u", text: t.slice(0, MAX_MESSAGE) });
        }
      }
    }

    if (row.type === "assistant") {
      const msg = row.message as
        { content?: unknown; model?: string } | undefined;
      if (!msg) return;
      if (typeof msg.model === "string") rec.model = msg.model;
      if (!withText) return;
      const t = textOf(msg.content);
      if (t && rec.messages.length < MAX_MESSAGES) {
        rec.messages.push({ role: "a", text: t.slice(0, MAX_MESSAGE) });
      }
    }
  });

  return rec;
}

function textBytes(rec: ContextRecord): number {
  let n = 0;
  for (const m of rec.messages) n += m.text.length;
  return n;
}

function readCache(): CacheFile {
  try {
    const j = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CacheFile;
    if (j && j.v === SCHEMA && j.entries) return j;
  } catch {
    // absent, unreadable, or a stale schema — rebuild from scratch
  }
  return { v: SCHEMA, entries: {} };
}

// Write via a temp file + rename so a crash mid-write can't leave a truncated
// cache that every later launch then throws away. 0600: transcripts carry
// whatever you pasted into them.
function writeCache(cache: CacheFile): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    renameSync(tmp, CACHE_FILE);
  } catch {
    // A cache we can't persist just costs a rebuild next launch — never fatal.
  }
}

// Every session transcript: ~/.claude/projects/<enc-cwd>/<session>.jsonl. The
// nested <session>/subagents/*.jsonl files are a session's children, not
// sessions, so only this one level is enumerated (same rule as history.ts).
function transcriptPaths(): string[] {
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const d of dirs) {
    let files: string[];
    try {
      files = readdirSync(join(PROJECTS_DIR, d), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const f of files) out.push(join(PROJECTS_DIR, d, f));
  }
  return out;
}

/**
 * The full index, newest first. Only transcripts whose mtime changed are
 * re-parsed; everything else is served from the on-disk cache. Entries for
 * transcripts that no longer exist are dropped, so a deleted session leaves.
 */
export function buildIndex(): ContextRecord[] {
  const cache = readCache();
  const next: Record<string, CacheEntry> = {};
  const out: ContextRecord[] = [];
  let dirty = false;
  let budget = TEXT_BUDGET;

  // stat() everything up front so parsing runs newest-first: the text budget is
  // then spent on the sessions you're most likely to be looking for.
  const files: { path: string; mtimeMs: number }[] = [];
  for (const path of transcriptPaths()) {
    try {
      files.push({ path, mtimeMs: statSync(path).mtimeMs });
    } catch {
      continue; // vanished between readdir and stat
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { path, mtimeMs } of files) {
    const sessionId = basename(path).replace(/\.jsonl$/, "");
    const hit = cache.entries[path];
    let rec: ContextRecord;
    let truncated: boolean;
    // A cached record that was truncated is re-parsed once budget frees up, so
    // a session doesn't stay text-less forever after one crowded build.
    if (hit && hit.mtimeMs === mtimeMs && !(hit.truncated && budget > 0)) {
      rec = hit.rec;
      truncated = Boolean(hit.truncated);
    } else {
      const withText = budget > 0;
      rec = parse(path, sessionId, mtimeMs, withText);
      truncated = !withText;
      dirty = true;
    }
    budget -= textBytes(rec);
    next[path] = { mtimeMs, rec, truncated };
    // A session with no cwd never started work — nothing to resume or show.
    if (rec.root) out.push(rec);
  }

  if (dirty || Object.keys(next).length !== Object.keys(cache.entries).length) {
    writeCache({ v: SCHEMA, entries: next });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Drop the cache so the next buildIndex() re-reads every transcript. */
export function clearIndex(): void {
  try {
    unlinkSync(CACHE_FILE);
  } catch {
    // already gone
  }
}

/** Where a context lives, for display: the worktree dir under its parent. */
export function shortPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** True when the session's directory is gone (worktree removed since). */
export function isOrphaned(rec: ContextRecord): boolean {
  return Boolean(rec.root) && !existsSync(rec.root);
}

/** The repo dir a worktree hangs off, for grouping: `<repo>/.claude-worktrees/x` → `<repo>`. */
export function worktreeParent(p: string): string {
  const marks = [".claude-worktrees", ".treehouse", "worktrees"];
  const parts = p.split("/");
  for (const m of marks) {
    const i = parts.indexOf(m);
    if (i > 0) return parts.slice(0, i).join("/");
  }
  return dirname(p);
}

// Read Claude session transcripts from ~/.claude/projects/<enc-cwd>/<id>.jsonl.
// We extract a title (the Claude-generated `aiTitle`), the cwd (read from inside
// the transcript — never reverse the dir name), last-active (file mtime) and
// turn count. Parsed metadata is cached by file mtime so unchanged transcripts
// aren't re-read (SPEC §6.2, §9).

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { StringDecoder } from "string_decoder";

export interface TranscriptMeta {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: number; // mtime ms
  turns: number;
  lastMessage: string; // last assistant text (the "pending question")
  model: string; // last model seen
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

const cache = new Map<string, { mtimeMs: number; meta: TranscriptMeta }>();

// Assistant message content is either a string or an array of blocks; pull the
// text blocks.
function assistantText(content: unknown): string {
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

const EMPTY = (sessionId: string): TranscriptMeta => ({
  sessionId,
  cwd: "",
  title: "",
  updatedAt: 0,
  turns: 0,
  lastMessage: "",
  model: "",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

// A user row is a real turn only if it carries actual user input. Claude Code
// also writes tool RESULTS as type:"user" rows (content = tool_result blocks),
// which shouldn't inflate the turn count.
function isUserTurn(message: unknown): boolean {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content))
    return content.some(
      (b) => b && (b as { type?: string }).type !== "tool_result",
    );
  return false;
}

// Read a file line by line, holding only one chunk plus one line at a time.
// Transcripts reach tens of MB; readFileSync + split("\n") materializes the
// whole file (plus a line array) at once, which overflows the menu-bar worker's
// heap once the Raycast runtime's own baseline is loaded. SPEC §9.
function eachLine(path: string, onLine: (line: string) => void): void {
  const CHUNK = 1 << 18; // 256 KB
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return;
  }
  const buf = Buffer.allocUnsafe(CHUNK);
  // A multi-byte UTF-8 char can straddle a chunk boundary; StringDecoder holds
  // the partial bytes back until the next chunk completes them, where a plain
  // buf.toString() would emit U+FFFD and corrupt the JSON.
  const decoder = new StringDecoder("utf8");
  let tail = "";
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const text = tail + decoder.write(buf.subarray(0, n));
      let start = 0;
      for (;;) {
        const nl = text.indexOf("\n", start);
        if (nl === -1) break;
        onLine(text.slice(start, nl));
        start = nl + 1;
      }
      tail = text.slice(start);
    }
    tail += decoder.end();
    if (tail) onLine(tail);
  } finally {
    closeSync(fd);
  }
}

function parseTranscript(path: string, sessionId: string): TranscriptMeta {
  const meta = EMPTY(sessionId);
  eachLine(path, (line) => {
    if (!line) return;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (!meta.cwd && typeof row.cwd === "string") meta.cwd = row.cwd;
    if (row.type === "user" && isUserTurn(row.message)) meta.turns++;
    if (row.type === "ai-title" && typeof row.aiTitle === "string") {
      if (row.sessionId === sessionId || !meta.title) meta.title = row.aiTitle;
    }
    if (row.type === "assistant") {
      const msg = row.message as
        | { content?: unknown; model?: string; usage?: Record<string, number> }
        | undefined;
      if (msg) {
        const t = assistantText(msg.content);
        if (t) meta.lastMessage = t.slice(0, 1200);
        if (typeof msg.model === "string") meta.model = msg.model;
        const u = msg.usage;
        if (u) {
          meta.inputTokens += u.input_tokens || 0;
          meta.outputTokens += u.output_tokens || 0;
          meta.cacheReadTokens += u.cache_read_input_tokens || 0;
          meta.cacheWriteTokens += u.cache_creation_input_tokens || 0;
        }
      }
    }
  });
  return meta;
}

export function findTranscriptPath(sessionId: string): string | null {
  let dirs: string[];
  try {
    dirs = readdirSync(PROJECTS_DIR);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const p = join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

export function deleteTranscript(sessionId: string): boolean {
  const p = findTranscriptPath(sessionId);
  if (!p) return false;
  try {
    unlinkSync(p);
    cache.delete(p);
    return true;
  } catch {
    return false;
  }
}

export function readTranscripts(): Map<string, TranscriptMeta> {
  const out = new Map<string, TranscriptMeta>();
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }

  for (const pd of projectDirs) {
    const dir = join(PROJECTS_DIR, pd);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = join(dir, f);
      const sessionId = f.replace(/\.jsonl$/, "");
      let mtimeMs: number;
      try {
        mtimeMs = statSync(full).mtimeMs;
      } catch {
        continue;
      }
      const cached = cache.get(full);
      let meta: TranscriptMeta;
      if (cached && cached.mtimeMs === mtimeMs) {
        meta = cached.meta;
      } else {
        meta = parseTranscript(full, sessionId);
        meta.updatedAt = mtimeMs;
        cache.set(full, { mtimeMs, meta });
      }
      out.set(sessionId, { ...meta, updatedAt: mtimeMs });
    }
  }
  return out;
}

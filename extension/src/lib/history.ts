// Read Claude session transcripts from ~/.claude/projects/<enc-cwd>/<id>.jsonl.
// We extract a title (the Claude-generated `aiTitle`), the cwd (read from inside
// the transcript — never reverse the dir name), last-active (file mtime) and
// turn count. Parsed metadata is cached by file mtime so unchanged transcripts
// aren't re-read (SPEC §6.2, §9).

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
      .filter((b) => b && (b as { type?: string }).type === "text" && typeof (b as { text?: string }).text === "string")
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

function parseTranscript(path: string, sessionId: string): TranscriptMeta {
  const meta = EMPTY(sessionId);
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return meta;
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!meta.cwd && typeof row.cwd === "string") meta.cwd = row.cwd;
    if (row.type === "user") meta.turns++;
    if (row.type === "ai-title" && typeof row.aiTitle === "string") {
      if (row.sessionId === sessionId || !meta.title) meta.title = row.aiTitle;
    }
    if (row.type === "assistant") {
      const msg = row.message as { content?: unknown; model?: string; usage?: Record<string, number> } | undefined;
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
  }
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

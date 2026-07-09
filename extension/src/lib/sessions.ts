// Read Claude Code's own live session registry: ~/.claude/sessions/<pid>.json.
// Claude maintains one file per live session and removes it on exit, so this is
// the authoritative source of which agents are active (SPEC §6.1).

import { readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface ClaudeSession {
  sessionId: string;
  cwd: string;
  pid: number;
  status: "busy" | "idle";
  name?: string;
  updatedAt: number;
}

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

export function readActiveSessions(): ClaudeSession[] {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const out: ClaudeSession[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (typeof j.sessionId === "string" && typeof j.cwd === "string") {
        out.push({
          sessionId: j.sessionId,
          cwd: j.cwd,
          pid: typeof j.pid === "number" ? j.pid : 0,
          status: j.status === "busy" ? "busy" : "idle",
          name: typeof j.name === "string" ? j.name : undefined,
          updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : 0,
        });
      }
    } catch {
      // skip unreadable/partial files
    }
  }
  return out;
}

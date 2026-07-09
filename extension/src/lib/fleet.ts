// Optional enrichment from the fleet hook: ~/.claude/fleet/<sessionId>.json
// (written by fleet-register.sh in claude-mac-tweaks). Adds finer state
// (waiting/done), the task label, diff, and last tool. SPEC §6.1a.

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface FleetEntry {
  state?: string; // working | waiting | done | idle
  stateReason?: string;
  task?: string;
  diff?: string;
  lastTool?: string;
  branch?: string;
}

const FLEET_DIR = join(homedir(), ".claude", "fleet");

export function readFleetEntry(sessionId: string): FleetEntry | undefined {
  try {
    const j = JSON.parse(readFileSync(join(FLEET_DIR, `${sessionId}.json`), "utf8"));
    return {
      state: typeof j.state === "string" ? j.state : undefined,
      stateReason: j.state_reason || undefined,
      task: j.task || undefined,
      diff: j.diff || undefined,
      lastTool: j.last_tool || undefined,
      branch: j.branch || undefined,
    };
  } catch {
    return undefined;
  }
}

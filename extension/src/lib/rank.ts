// Merge Claude's live session registry (active) with transcript history
// (recent), refine active state with the fleet hook, dedup by sessionId, and
// sort each group by recency. SPEC §6.3.

import { basename } from "path";
import { Agent, AgentState } from "./types";
import { readActiveSessions } from "./sessions";
import { readTranscripts } from "./history";
import { readFleetEntry } from "./fleet";

function repoOf(cwd: string): string {
  return basename(cwd || "") || "?";
}

// `activeOnly`: callers that render only live agents (menu bar, Next Waiting
// Agent) skip the whole-history sweep — parse just the active transcripts and
// don't build the `recent` list.
export function loadAgents(opts?: { activeOnly?: boolean }): {
  active: Agent[];
  recent: Agent[];
} {
  const sessions = readActiveSessions();
  const activeIds = new Set(sessions.map((s) => s.sessionId));
  const metas = readTranscripts(opts?.activeOnly ? activeIds : undefined);

  const active: Agent[] = sessions.map((s) => {
    const m = metas.get(s.sessionId);
    const fleet = readFleetEntry(s.sessionId);

    // Claude's busy = actively working. When Claude is idle, the fleet hook (if
    // present) says which kind of idle: waiting-on-permission / done / idle.
    let state: AgentState;
    if (s.status === "busy") {
      state = "working";
    } else if (
      fleet?.state === "waiting" ||
      fleet?.state === "done" ||
      fleet?.state === "idle"
    ) {
      state = fleet.state;
    } else {
      state = "idle";
    }

    return {
      sessionId: s.sessionId,
      transcriptPath: m?.path,
      cwd: s.cwd,
      repo: repoOf(s.cwd),
      title: fleet?.task || m?.title || s.name || repoOf(s.cwd),
      live: true,
      state,
      stateReason: state === "waiting" ? fleet?.stateReason : undefined,
      diff: fleet?.diff || undefined,
      lastTool: state === "working" ? fleet?.lastTool : undefined,
      mode: fleet?.mode || undefined,
      question: m?.lastMessage || undefined,
      pid: s.pid,
      updatedAt: s.updatedAt || m?.updatedAt || 0,
    };
  });

  const recent: Agent[] = [];
  // In activeOnly mode `metas` holds only active sessions, so there's nothing to
  // build here — skip the loop entirely.
  for (const m of opts?.activeOnly ? [] : metas.values()) {
    if (activeIds.has(m.sessionId)) continue;
    if (!m.cwd) continue;
    recent.push({
      sessionId: m.sessionId,
      transcriptPath: m.path,
      cwd: m.cwd,
      repo: repoOf(m.cwd),
      title: m.title || repoOf(m.cwd),
      live: false,
      state: "idle",
      updatedAt: m.updatedAt,
      turns: m.turns,
      question: m.lastMessage || undefined,
    });
  }

  active.sort((a, b) => b.updatedAt - a.updatedAt);
  recent.sort((a, b) => b.updatedAt - a.updatedAt);
  return { active, recent };
}

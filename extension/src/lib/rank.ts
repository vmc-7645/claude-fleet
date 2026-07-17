// Merge Claude's live session registry (active) with transcript history
// (recent), refine active state with the fleet hook, dedup by sessionId, and
// sort each group by recency. SPEC §6.3.

import { basename } from "path";
import { Agent, liveState } from "./types";
import { readActiveSessions } from "./sessions";
import { readTranscripts } from "./history";
import { readFleetEntry } from "./fleet";

function repoOf(cwd: string): string {
  return basename(cwd || "") || "?";
}

export function loadAgents(): { active: Agent[]; recent: Agent[] } {
  const sessions = readActiveSessions();
  const activeIds = new Set(sessions.map((s) => s.sessionId));
  const metas = readTranscripts();

  const active: Agent[] = sessions.map((s) => {
    const m = metas.get(s.sessionId);
    const fleet = readFleetEntry(s.sessionId);

    const state = liveState(s.status === "busy", fleet?.state);

    return {
      sessionId: s.sessionId,
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
  for (const m of metas.values()) {
    if (activeIds.has(m.sessionId)) continue;
    if (!m.cwd) continue;
    recent.push({
      sessionId: m.sessionId,
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

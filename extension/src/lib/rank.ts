// Merge Claude's live session registry (active) with transcript history
// (recent), dedup by sessionId, and sort each group by recency. SPEC §6.3.

import { basename } from "path";
import { Agent } from "./types";
import { readActiveSessions } from "./sessions";
import { readTranscripts } from "./history";

function repoOf(cwd: string): string {
  return basename(cwd || "") || "?";
}

export function loadAgents(): { active: Agent[]; recent: Agent[] } {
  const sessions = readActiveSessions();
  const activeIds = new Set(sessions.map((s) => s.sessionId));
  const metas = readTranscripts();

  const active: Agent[] = sessions.map((s) => {
    const m = metas.get(s.sessionId);
    return {
      sessionId: s.sessionId,
      cwd: s.cwd,
      repo: repoOf(s.cwd),
      title: m?.title || s.name || repoOf(s.cwd),
      live: true,
      state: s.status === "busy" ? "working" : "idle",
      pid: s.pid,
      updatedAt: s.updatedAt || m?.updatedAt || 0,
    };
  });

  const recent: Agent[] = [];
  for (const m of metas.values()) {
    if (activeIds.has(m.sessionId)) continue;
    if (!m.cwd) continue; // skip transcripts we couldn't read a cwd from
    recent.push({
      sessionId: m.sessionId,
      cwd: m.cwd,
      repo: repoOf(m.cwd),
      title: m.title || repoOf(m.cwd),
      live: false,
      state: "idle",
      updatedAt: m.updatedAt,
      turns: m.turns,
    });
  }

  active.sort((a, b) => b.updatedAt - a.updatedAt);
  recent.sort((a, b) => b.updatedAt - a.updatedAt);
  return { active, recent };
}

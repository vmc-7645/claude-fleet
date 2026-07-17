// Next Waiting Agent — a no-view command (assign a hotkey): focus the agent
// that's been waiting on you longest, so you can clear a backlog one keystroke
// at a time. Opt-in (disabled by default). SPEC §5.1.

import { showHUD, closeMainWindow } from "@raycast/api";
import { loadAgents } from "./lib/rank";
import { focusOrRaise } from "./lib/claude";
import { focusSupported } from "./lib/terminal";

export default async function Command() {
  if (!focusSupported()) {
    await showHUD("Focus needs Ghostty (set your terminal in preferences)");
    return;
  }
  // Agents that need you = active but not actively working. Most urgent first
  // (waiting on permission > done > idle), oldest within a state. A busy session
  // derives as "working" and is excluded; the tab matcher also refuses to focus
  // a working agent's tab when the target isn't working (same-repo agents).
  const RANK: Record<string, number> = { waiting: 0, done: 1, idle: 2 };
  const { active } = loadAgents({ activeOnly: true });
  const next = active
    .filter((a) => a.state !== "working")
    .sort(
      (a, b) =>
        (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) ||
        a.updatedAt - b.updatedAt,
    )[0];

  if (!next) {
    await showHUD("✅ No agents need you right now");
    return;
  }
  await closeMainWindow();
  const ok = await focusOrRaise(next).catch(() => false);
  await showHUD(
    ok
      ? `→ ${next.repo}${next.title ? ` — ${next.title}` : ""}`
      : `Raised terminal — no exact tab for ${next.repo}`,
  );
}

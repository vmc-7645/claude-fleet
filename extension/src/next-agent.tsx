// Next Waiting Agent — a no-view command (assign a hotkey): focus the agent
// that's been waiting on you longest, so you can clear a backlog one keystroke
// at a time. Opt-in (disabled by default). SPEC §5.1.

import { showHUD, closeMainWindow } from "@raycast/api";
import { loadAgents } from "./lib/rank";
import { focusOrRaise } from "./lib/claude";
import { focusSupported } from "./lib/terminal";
import { Agent } from "./lib/types";

// "Needs you" = active but not actively working, most urgent first
// (waiting → done → idle), and within a state the one waiting longest.
const RANK: Record<string, number> = { waiting: 0, done: 1, idle: 2 };

export default async function Command() {
  if (!focusSupported()) {
    await showHUD("Focus needs Ghostty (set your terminal in preferences)");
    return;
  }
  const { active } = loadAgents();
  const next = active
    .filter((a) => a.state !== "working")
    .sort(
      (a: Agent, b: Agent) =>
        (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) ||
        a.updatedAt - b.updatedAt,
    )[0];

  if (!next) {
    await showHUD("✅ No agents waiting on you");
    return;
  }
  await closeMainWindow();
  const ok = await focusOrRaise(next)
    .then(() => true)
    .catch(() => false);
  await showHUD(
    ok
      ? `→ ${next.repo}${next.title ? ` — ${next.title}` : ""}`
      : "Tab not found",
  );
}

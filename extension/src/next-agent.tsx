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
  // Only agents blocked on you (state "waiting"). A busy session is derived as
  // "working" (never "waiting"), so this can't focus an actively-working agent.
  // done/idle aren't "waiting". Oldest wait first, to clear the backlog.
  const { active } = loadAgents();
  const next = active
    .filter((a) => a.state === "waiting")
    .sort((a, b) => a.updatedAt - b.updatedAt)[0];

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

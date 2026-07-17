// Ghostty window/tab automation — the one place that drives Ghostty via macOS
// Accessibility. Two jobs:
//   1. OPEN a command in a tab/window, with project affinity (§ chooseTargetWindow)
//      and a robust "new window" path (⌘N) when no window can be reused.
//   2. ENUMERATE windows/tabs and FOCUS an exact one (used by claude.ts for
//      Focus Tab / Nudge / Close Tab).
// Ghostty has no CLI to open a tab/window in the running instance on macOS
// (`open --args -e` is dropped when an instance already exists, so the agent
// command never runs), so everything below keystrokes the app — ⌘T / ⌘N then
// types "cd <dir> && <cmd>". SPEC §8.

import { runAppleScript } from "@raycast/utils";
import { basename } from "path";
import { asStr, shq } from "./terminal";
import { prefs } from "./prefs";
import { GWindow, chooseTargetWindow } from "./tabmatch";
import {
  ENUMERATE,
  raiseWindowScript,
  focusScript,
  dockPressScript,
} from "./ghostty-script";

// Delay (seconds) after ⌘T/⌘N before typing, so the new shell is ready to
// receive the command. Too short under load and the keystrokes are dropped and
// the agent never starts — the classic "tab opens in the right dir but claude
// doesn't run". Configurable via the tabOpenDelay pref (SPEC §8 step 3).
function openDelay(): number {
  const raw = Number(prefs().tabOpenDelay);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.7;
}

// Read Ghostty's windows and tabs. Retries a flaky System Events -10000 a few
// times; returns [] if Ghostty has no windows (or the read keeps failing).
export async function enumerateGhostty(): Promise<GWindow[]> {
  let raw = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      raw = await runAppleScript(ENUMERATE);
      if (raw.trim()) break;
    } catch (e) {
      console.error(
        `[ghostty] enumerate attempt ${attempt} error: ${String(e).slice(0, 120)}`,
      );
    }
  }

  const byIndex = new Map<number, GWindow>();
  for (const line of raw.split("\n")) {
    if (!line.includes("|||")) continue;
    const parts = line.split("|||");
    if (parts.length < 5) continue;
    const win = parseInt(parts[1], 10);
    const tab = parseInt(parts[2], 10);
    if (!Number.isFinite(win)) continue;
    const fs = parts[3] === "1";
    const title = parts.slice(4).join("|||");
    let w = byIndex.get(win);
    if (!w) {
      w = { index: win, title: "", fs, tabs: [] };
      byIndex.set(win, w);
    }
    if (parts[0] === "W") w.title = title;
    else if (parts[0] === "T" && Number.isFinite(tab))
      w.tabs.push({ index: tab, title });
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

// Is Ghostty the frontmost app right now? (After a focus, if it isn't, the raise
// didn't cross Spaces and we need the Dock-press retry.)
async function ghosttyFrontmost(): Promise<boolean> {
  try {
    const r = await runAppleScript(
      'tell application "System Events" to return name of first process whose frontmost is true',
    );
    return r.trim() === "Ghostty";
  } catch {
    return false;
  }
}

// Focus a matched window/tab, then VERIFY Ghostty actually came to the front —
// activate/AXRaise silently fail to cross Spaces for some window states, so if
// Ghostty isn't frontmost we retry once with the Dock-press (which reliably
// switches Spaces to its main window, already set to the target above).
export async function focusWindowTab(
  win: number,
  tab: number | null,
  spaceSwitch: boolean,
): Promise<boolean> {
  try {
    await runAppleScript(focusScript(win, tab, spaceSwitch).join("\n"));
  } catch {
    return false;
  }
  if (await ghosttyFrontmost()) return true;
  // Didn't come forward — force the Space switch and re-activate.
  try {
    await runAppleScript(
      [...dockPressScript(), 'tell application "Ghostty" to activate'].join(
        "\n",
      ),
    );
  } catch {
    return false;
  }
  return true;
}

// Is Ghostty running at all? (A cold app needs a launch, not a keystroke.)
async function ghosttyRunning(): Promise<boolean> {
  try {
    const r = await runAppleScript(
      'tell application "System Events" to (exists process "Ghostty")',
    );
    return r.trim() === "true";
  } catch {
    return false;
  }
}

// Type a command into the frontmost Ghostty surface after a readiness delay.
// Ghostty renders the terminal on the GPU and exposes NO text via Accessibility,
// so we can't detect the shell prompt directly — openDelay() is the settle for
// shell init; openSurface() below covers the observable half (the tab existing).
async function typeCommand(typed: string): Promise<void> {
  await runAppleScript(
    [
      "delay " + openDelay(),
      'tell application "System Events"',
      `  keystroke ${asStr(typed)}`,
      "  key code 36",
      "end tell",
    ].join("\n"),
  );
}

// Terminal surfaces currently open (tabs; a single-tab window with no tab group
// counts as 1). Order-independent so it survives the window re-ordering a raise
// causes.
function countSurfaces(ws: GWindow[]): number {
  return ws.reduce((n, w) => n + Math.max(w.tabs.length, 1), 0);
}

// Send ⌘T (or ⌘N) and wait for the new surface to actually materialize before we
// type into it — the reliable, observable readiness signal (Ghostty exposes no
// terminal text). If the keystroke was dropped (no new surface within ~2s), retry
// it once. `before` is the surface count taken just before the keystroke.
async function openSurface(key: "t" | "n", before: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await runAppleScript(
      [
        'tell application "Ghostty" to activate',
        "delay 0.2",
        `tell application "System Events" to keystroke "${key}" using {command down}`,
      ].join("\n"),
    );
    for (let i = 0; i < 12; i++) {
      if (countSurfaces(await enumerateGhostty()) > before) return;
      await runAppleScript("delay 0.15");
    }
    // No new surface — the ⌘ keystroke was likely dropped; loop retries once.
  }
}

// Open `typed` in a brand-new Ghostty window (⌘N). Used as the last-resort path
// (no window to reuse) and when tabOpenMode = window. Cold-start: if Ghostty
// isn't running, launch it — its initial window is our target, so no ⌘N.
async function openInNewWindow(typed: string): Promise<void> {
  const running = await ghosttyRunning();
  if (!running) {
    await runAppleScript('do shell script "open -a Ghostty.app"');
    // Wait for the initial window to exist, then type into it (no ⌘N needed).
    for (let i = 0; i < 20; i++) {
      const wins = await enumerateGhostty();
      if (wins.length) break;
      await runAppleScript("delay 0.25");
    }
    await runAppleScript('tell application "Ghostty" to activate');
    await typeCommand(typed);
    return;
  }
  const before = countSurfaces(await enumerateGhostty());
  await openSurface("n", before);
  await typeCommand(typed);
}

// Open `command` (cd'd into `cwd`) in Ghostty, choosing the window by project
// affinity. Preferred order: reuse a window already hosting this project → reuse
// the frontmost window → (only if there are none, or tabOpenMode = window) a new
// window. This is the main entry the terminal abstraction delegates to.
export async function openGhosttyTab(
  cwd: string,
  command: string,
): Promise<void> {
  const typed = `cd ${shq(cwd)} && ${command}`;

  if (prefs().tabOpenMode === "window") {
    await openInNewWindow(typed);
    return;
  }

  const windows = await enumerateGhostty();
  if (windows.length === 0) {
    await openInNewWindow(typed);
    return;
  }

  // Bias into the window already hosting this project (else the frontmost one),
  // raise it so ⌘T lands there, then open the tab and type the command.
  const repo = basename(cwd);
  const target = chooseTargetWindow(windows, repo);
  if (target) {
    await runAppleScript(
      raiseWindowScript(target.index, target.fs || target.index !== 1).join(
        "\n",
      ),
    );
  }
  await openSurface("t", countSurfaces(windows));
  await typeCommand(typed);
}

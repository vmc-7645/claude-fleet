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

// Delay (seconds) after ⌘T/⌘N before typing, so the new shell is ready to
// receive the command. Too short under load and the keystrokes are dropped and
// the agent never starts — the classic "tab opens in the right dir but claude
// doesn't run". Configurable via the tabOpenDelay pref (SPEC §8 step 3).
function openDelay(): number {
  const raw = Number(prefs().tabOpenDelay);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.7;
}

// Find a window's tab group and bind it to `tg` (missing value if none). In a
// normal window the AXTabGroup is a direct child; in a NATIVE-FULLSCREEN window
// Ghostty nests it one level deeper (window → AXGroup → AXTabGroup), so a plain
// `first tab group of w` finds nothing and every background tab becomes
// invisible. Search depth 0, then depth 1. `wref` is the window expression.
function findTabGroup(wref: string): string[] {
  return [
    "    set tg to missing value",
    "    try",
    `      set tg to first tab group of ${wref}`,
    "    end try",
    "    if tg is missing value then",
    `      repeat with g in (UI elements of ${wref})`,
    "        try",
    "          set tg to first tab group of g",
    "          exit repeat",
    "        end try",
    "      end repeat",
    "    end if",
  ];
}

// NOTE: avoid the `tab` keyword inside `tell process` — it shadows a UI-element
// class and throws -10000. Each line carries a fullscreen flag ("1"/"0") so
// focus can switch Spaces for a native-fullscreen window. Fields:
// KIND|||win|||tab|||fs|||title. We enumerate BOTH each window's title AND, when
// a window has a tab bar, each tab's title. A single-tab Ghostty window has NO
// AXTabGroup, so tabs-only enumeration misses it entirely — the window title is
// how we find those.
const ENUMERATE = [
  'tell application "System Events"',
  '  tell process "Ghostty"',
  '    set out to ""',
  "    set wc to count of windows",
  "    repeat with wi from 1 to wc",
  "      set w to window wi",
  '      set wt to ""',
  "      try",
  "        set wt to title of w",
  "      end try",
  '      set fs to "0"',
  "      try",
  '        if (value of attribute "AXFullScreen" of w) is true then set fs to "1"',
  "      end try",
  '      set out to out & "W|||" & (wi as text) & "|||0|||" & fs & "|||" & wt & linefeed',
  ...findTabGroup("w"),
  "      if tg is not missing value then",
  "        set ti to 0",
  "        repeat with rb in (radio buttons of tg)",
  "          set ti to ti + 1",
  "          try",
  '            set out to out & "T|||" & (wi as text) & "|||" & (ti as text) & "|||" & fs & "|||" & (title of rb) & linefeed',
  "          end try",
  "        end repeat",
  "      end if",
  "    end repeat",
  "    return out",
  "  end tell",
  "end tell",
].join("\n");

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

// Bring a window forward so a subsequent ⌘T lands in it. Same depth-0-or-1 tab-
// group search as enumeration. A native-fullscreen window (or any background
// window, which may sit on another Space) is not reached by activate/AXRaise
// alone — pressing the app's Dock tile switches Spaces to its main window, so we
// finish with that when a Space switch may be needed.
function raiseWindowScript(win: number, spaceSwitch: boolean): string[] {
  const lines = [
    'tell application "System Events"',
    '  tell process "Ghostty"',
    "    try",
    `      set value of attribute "AXMain" of window ${win} to true`,
    "    end try",
    `    perform action "AXRaise" of window ${win}`,
    "  end tell",
    "end tell",
    'tell application "Ghostty" to activate',
  ];
  if (spaceSwitch) lines.push(...dockPressScript());
  return lines;
}

// Press Ghostty's Dock tile — the reliable way to switch Spaces to its main
// window (activate/AXRaise do not cross Spaces).
function dockPressScript(): string[] {
  return [
    'tell application "System Events"',
    '  tell process "Dock"',
    "    try",
    '      perform action "AXPress" of (first UI element of list 1 whose name is "Ghostty")',
    "    end try",
    "  end tell",
    "end tell",
  ];
}

// Focus a matched window/tab: raise the window, press its tab's radio button
// when it's one of several, and switch Spaces if needed. `spaceSwitch` should be
// true for a fullscreen target OR any background window (win !== 1), since a
// background window may live on another Space.
export async function focusWindowTab(
  win: number,
  tab: number | null,
  spaceSwitch: boolean,
): Promise<boolean> {
  const lines = [
    'tell application "System Events"',
    '  tell process "Ghostty"',
    "    try",
    `      set value of attribute "AXMain" of window ${win} to true`,
    "    end try",
    `    perform action "AXRaise" of window ${win}`,
  ];
  if (tab !== null) {
    lines.push(
      ...findTabGroup(`window ${win}`),
      "    if tg is not missing value then",
      "      try",
      `        perform action "AXPress" of (radio button ${tab} of tg)`,
      "      end try",
      "    end if",
    );
  }
  lines.push(
    "  end tell",
    "end tell",
    'tell application "Ghostty" to activate',
  );
  if (spaceSwitch) lines.push(...dockPressScript());
  try {
    await runAppleScript(lines.join("\n"));
    return true;
  } catch {
    return false;
  }
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
  await runAppleScript(
    [
      'tell application "Ghostty" to activate',
      "delay 0.2",
      'tell application "System Events" to keystroke "n" using {command down}',
    ].join("\n"),
  );
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
  await runAppleScript(
    [
      'tell application "Ghostty" to activate',
      "delay 0.2",
      'tell application "System Events" to keystroke "t" using {command down}',
    ].join("\n"),
  );
  await typeCommand(typed);
}

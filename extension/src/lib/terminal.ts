// Terminal abstraction: open a new tab running a command, and activate the app.
// Ghostty is the default and the only one with full tab control (Focus Tab /
// Nudge / Close Tab rely on Ghostty's AXTabGroup — see claude.ts); iTerm2 and
// Apple Terminal support opening tabs and everything routed through openTab.

import { runAppleScript } from "@raycast/utils";
import { prefs } from "./prefs";
import { openGhosttyTab } from "./ghostty";

export type TermId = "ghostty" | "iterm" | "terminal";

const APP: Record<TermId, string> = {
  ghostty: "Ghostty",
  iterm: "iTerm",
  terminal: "Terminal",
};

export function terminalApp(): TermId {
  const v = prefs().terminalApp;
  return v === "iterm" || v === "terminal" ? v : "ghostty";
}

export function terminalName(): string {
  return APP[terminalApp()];
}

// Only Ghostty exposes per-tab titles via accessibility, so Focus/Nudge/Close
// (which match and drive an exact tab) are Ghostty-only. Everything else works
// on any supported terminal.
export function focusSupported(): boolean {
  return terminalApp() === "ghostty";
}

// Shell-quote (for the command we run inside the terminal).
export function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// AppleScript string literal.
export function asStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// iTerm2 has first-class scripting: new tab (or window) + write text.
function itermScript(typed: string): string {
  return [
    'tell application "iTerm"',
    "  activate",
    "  if (count of windows) = 0 then",
    "    create window with default profile",
    "  else",
    "    tell current window to create tab with default profile",
    "  end if",
    `  tell current session of current window to write text ${asStr(typed)}`,
    "end tell",
  ].join("\n");
}

// Apple Terminal: new tab in the front window (or a new window if none is open),
// then run in it. `do script` with no target opens a fresh window+tab.
function terminalScript(typed: string): string {
  return [
    'tell application "Terminal"',
    "  activate",
    "  if (count of windows) is 0 then",
    `    do script ${asStr(typed)}`,
    "  else",
    '    tell application "System Events" to keystroke "t" using {command down}',
    "    delay 0.4",
    `    do script ${asStr(typed)} in front window`,
    "  end if",
    "end tell",
  ].join("\n");
}

// Open `command` in a new terminal tab, cd'd into `cwd`. Ghostty gets the
// window-aware opener (project affinity + robust new-window fallback, ghostty.ts);
// iTerm2/Terminal use their own scripting.
export async function openTerminalTab(
  cwd: string,
  command: string,
): Promise<void> {
  const t = terminalApp();
  if (t === "ghostty") {
    await openGhosttyTab(cwd, command);
    return;
  }
  const typed = `cd ${shq(cwd)} && ${command}`;
  await runAppleScript(
    t === "iterm" ? itermScript(typed) : terminalScript(typed),
  );
}

// Bring the terminal app to the front (fallback when we can't target a tab).
export async function activateTerminalApp(): Promise<void> {
  await runAppleScript(`tell application ${asStr(terminalName())} to activate`);
}

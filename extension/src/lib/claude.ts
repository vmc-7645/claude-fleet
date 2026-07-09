// `→ Claude` actions: open a Ghostty tab running a command (resume / fork), and
// raise Ghostty. Mirrors the AppleScript in claude-worktree/claude-restore; will
// move to the shared `claude-open-tab` helper at M2 (SPEC §8).

import { runAppleScript } from "@raycast/utils";
import { Agent } from "./types";

// Single-quote a string for POSIX shell.
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// AppleScript string literal.
function asStr(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

async function openInGhosttyTab(cwd: string, command: string): Promise<void> {
  const typed = `cd ${shq(cwd)} && ${command}`;
  await runAppleScript(
    [
      'tell application "Ghostty" to activate',
      "delay 0.2",
      'tell application "System Events"',
      '  keystroke "t" using {command down}',
      "  delay 0.6",
      `  keystroke ${asStr(typed)}`,
      "  key code 36",
      "end tell",
    ].join("\n"),
  );
}

export async function resumeAgent(a: Agent): Promise<void> {
  await openInGhosttyTab(a.cwd, `claude --resume ${a.sessionId}`);
}

export async function forkAgent(a: Agent): Promise<void> {
  await openInGhosttyTab(a.cwd, `claude --resume ${a.sessionId} --fork-session`);
}

export async function jumpToGhostty(): Promise<void> {
  await runAppleScript('tell application "Ghostty" to activate');
}

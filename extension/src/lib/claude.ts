// `→ Claude` actions: open a Ghostty tab running a command (resume / fork /
// review / spawn / undo), raise Ghostty, and stop an agent. Mirrors the
// AppleScript in claude-worktree/claude-restore (SPEC §8).

import { runAppleScript } from "@raycast/utils";
import { Agent } from "./types";
import { run } from "./exec";

function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

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

// Open the most-recent session for a directory in a new tab.
export async function continueInDir(cwd: string): Promise<void> {
  await openInGhosttyTab(cwd, "claude --continue");
}

export async function reviewPR(repoPath: string, prNumber: number): Promise<void> {
  await openInGhosttyTab(repoPath, `claude ${shq(`/review ${prNumber}`)}`);
}

export async function spawnAgent(repoPath: string, branch: string, task?: string): Promise<void> {
  await run("claude-worktree", [branch], {
    cwd: repoPath,
    env: task ? { CLAUDE_WT_PROMPT: task } : undefined,
  });
}

// Open claude-undo in a tab — it shows its own diff + confirmation (safer than a
// silent revert). SPEC §5.1.
export async function openUndo(cwd: string): Promise<void> {
  await openInGhosttyTab(cwd, "claude-undo");
}

// Best-effort stop: SIGINT the claude process (Claude's session registry pid IS
// the process). Interrupts current work. SPEC §5.1.1.
export function stopAgent(pid: number): void {
  process.kill(pid, "SIGINT");
}

// Resume the agent Claude linked to a PR. SPEC §5.2.1.
export async function resumeFromPr(repoPath: string, prNumber: number): Promise<void> {
  await openInGhosttyTab(repoPath, `claude --from-pr ${prNumber}`);
}

// Check out a PR into a fresh worktree and start an agent on it. Uses the PR's
// head branch, reusing claude-worktree's remote-tracking path. SPEC §5.2.
export async function checkoutAndWork(
  repoPath: string,
  repo: string,
  prNumber: number,
  title: string,
): Promise<void> {
  const branch = (
    await run("gh", ["pr", "view", String(prNumber), "-R", repo, "--json", "headRefName", "-q", ".headRefName"], {
      cwd: repoPath,
    })
  ).trim();
  if (!branch) throw new Error("could not resolve PR branch");
  await run("claude-worktree", [branch], {
    cwd: repoPath,
    env: { CLAUDE_WT_PROMPT: `Working on PR #${prNumber}: ${title}` },
  });
}

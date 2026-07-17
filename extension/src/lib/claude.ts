// `→ Claude` actions: open a terminal tab running a command (resume / fork /
// review / spawn / undo), raise the terminal, and stop an agent. Tab open/
// activate route through the terminal abstraction (default Ghostty); Focus Tab /
// Nudge / Close Tab drive an exact Ghostty tab via accessibility. SPEC §8.

import { runAppleScript } from "@raycast/utils";
import { homedir } from "os";
import { Agent } from "./types";
import { run } from "./exec";
import { AgentTab, TabCandidate, chooseTab } from "./tabmatch";
import { enumerateGhostty, focusWindowTab } from "./ghostty";
import {
  openTerminalTab,
  activateTerminalApp,
  focusSupported,
  shq,
  asStr,
} from "./terminal";

export async function resumeAgent(a: Agent): Promise<void> {
  await openTerminalTab(a.cwd, `claude --resume ${a.sessionId}`);
}

export async function forkAgent(a: Agent): Promise<void> {
  await openTerminalTab(a.cwd, `claude --resume ${a.sessionId} --fork-session`);
}

// The worktree's current branch — the strong, deterministic half of the match.
async function branchOf(cwd: string): Promise<string> {
  try {
    return (
      await run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  } catch {
    return "";
  }
}

export async function focusAgentTab(agent: Agent): Promise<boolean> {
  if (!focusSupported()) return false; // only Ghostty exposes per-tab titles
  const id: AgentTab = {
    repo: agent.repo,
    branch: await branchOf(agent.cwd),
    task: agent.title,
    state: agent.state,
  };

  // Flatten the window/tab tree into candidates; chooseTab ranks them (score,
  // then status-emoji to disambiguate two agents on the same repo:branch, then
  // a real tab T over the window-title fallback W).
  const windows = await enumerateGhostty();
  const candidates: TabCandidate[] = [];
  for (const w of windows) {
    candidates.push({
      kind: "W",
      win: w.index,
      tab: 0,
      fs: w.fs,
      title: w.title,
    });
    for (const t of w.tabs)
      candidates.push({
        kind: "T",
        win: w.index,
        tab: t.index,
        fs: w.fs,
        title: t.title,
      });
  }

  const best = chooseTab(id, candidates);
  if (!best) return false; // no match → caller raises the terminal
  // Switch Spaces for a fullscreen target OR any background window (win !== 1):
  // a background window may sit on another Space, which activate/AXRaise can't
  // reach on their own.
  const spaceSwitch = best.fs || best.win !== 1;
  return focusWindowTab(
    best.win,
    best.kind === "T" ? best.tab : null,
    spaceSwitch,
  );
}

// Focus the agent's exact tab; fall back to just raising the terminal if no
// match (or if the terminal isn't Ghostty).
export async function focusOrRaise(agent: Agent): Promise<void> {
  const ok = await focusAgentTab(agent);
  if (!ok) await activateTerminalApp();
}

// Close the agent's Ghostty tab (focus it, then ⌘W).
export async function closeAgentTab(agent: Agent): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) return false;
  await runAppleScript(
    'tell application "System Events" to keystroke "w" using {command down}',
  );
  return true;
}

// Type a follow-up into the agent's tab (focus it, then type + Return). Empty
// text just presses Return — accept a default / submit, or answer a numbered
// prompt by passing "1", "y", etc. Used by both Nudge and the Quick Reply presets.
export async function nudgeAgent(agent: Agent, text: string): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) return false;
  const lines = ['tell application "System Events"'];
  if (text) lines.push(`  keystroke ${asStr(text)}`);
  lines.push("  key code 36", "end tell");
  await runAppleScript(lines.join("\n"));
  return true;
}

export function resumeCommand(agent: Agent): string {
  return `cd ${shq(agent.cwd)} && claude --resume ${agent.sessionId}`;
}

// Open a folder in the configured editor (e.g. `code <path>`).
export async function openInEditor(
  path: string,
  editorCmd: string,
): Promise<void> {
  await run(editorCmd, [path]);
}

// Start a fresh Claude session in a repo (no worktree).
export async function newSessionInRepo(repoPath: string): Promise<void> {
  await openTerminalTab(repoPath, "claude");
}

// Open Claude's /mcp UI to (re)authenticate MCP servers.
export async function openMcpAuth(): Promise<void> {
  await openTerminalTab(homedir(), `claude ${shq("/mcp")}`);
}

// Run `claude doctor` in a tab.
export async function runDoctor(): Promise<void> {
  await openTerminalTab(homedir(), "claude doctor");
}

// Open the most-recent session for a directory in a new tab.
export async function continueInDir(cwd: string): Promise<void> {
  await openTerminalTab(cwd, "claude --continue");
}

export async function reviewPR(
  repoPath: string,
  prNumber: number,
): Promise<void> {
  await openTerminalTab(repoPath, `claude ${shq(`/review ${prNumber}`)}`);
}

export async function spawnAgent(
  repoPath: string,
  branch: string,
  task?: string,
): Promise<void> {
  await run("claude-worktree", [branch], {
    cwd: repoPath,
    env: task ? { CLAUDE_WT_PROMPT: task } : undefined,
  });
}

// Open claude-undo in a tab — it shows its own diff + confirmation (safer than a
// silent revert). SPEC §5.1.
export async function openUndo(cwd: string): Promise<void> {
  await openTerminalTab(cwd, "claude-undo");
}

// Best-effort stop: SIGINT the claude process (Claude's session registry pid IS
// the process). Interrupts current work. SPEC §5.1.1.
export function stopAgent(pid: number): void {
  process.kill(pid, "SIGINT");
}

// Resume the agent Claude linked to a PR. SPEC §5.2.1.
export async function resumeFromPr(
  repoPath: string,
  prNumber: number,
): Promise<void> {
  await openTerminalTab(repoPath, `claude --from-pr ${prNumber}`);
}

// Find the worktree (if any) that already has `branch` checked out.
async function worktreeForBranch(
  repoPath: string,
  branch: string,
): Promise<string | null> {
  try {
    const out = await run("git", [
      "-C",
      repoPath,
      "worktree",
      "list",
      "--porcelain",
    ]);
    let path = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (
        line.startsWith("branch ") &&
        line.slice("branch ".length).replace("refs/heads/", "") === branch
      )
        return path;
    }
  } catch {
    // fall through
  }
  return null;
}

// Start an agent on a PR. If the PR's branch is already checked out in a worktree
// (a branch can only live in one worktree), open the agent THERE; otherwise
// create a fresh worktree. SPEC §5.2.
export async function checkoutAndWork(
  repoPath: string,
  repo: string,
  prNumber: number,
  title: string,
): Promise<void> {
  const branch = (
    await run(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "-R",
        repo,
        "--json",
        "headRefName",
        "-q",
        ".headRefName",
      ],
      {
        cwd: repoPath,
      },
    )
  ).trim();
  if (!branch) throw new Error("could not resolve PR branch");
  const task = `Working on PR #${prNumber}: ${title}`;

  const existing = await worktreeForBranch(repoPath, branch);
  if (existing) {
    // Branch already checked out — open the agent in that worktree.
    await openTerminalTab(existing, `claude ${shq(task)}`);
    return;
  }
  await run("claude-worktree", [branch], {
    cwd: repoPath,
    env: { CLAUDE_WT_PROMPT: task },
  });
}

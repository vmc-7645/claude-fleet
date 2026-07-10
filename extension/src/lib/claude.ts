// `→ Claude` actions: open a Ghostty tab running a command (resume / fork /
// review / spawn / undo), raise Ghostty, and stop an agent. Mirrors the
// AppleScript in claude-worktree/claude-restore (SPEC §8).

import { runAppleScript } from "@raycast/utils";
import { Agent } from "./types";
import { run } from "./exec";
import { agentMatchesTab } from "./tabmatch";

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

// Focus the exact Ghostty tab for an agent by matching the tab title (which the
// tab-status hook sets to "<emoji> <repo>:<branch> — <task>"). Ghostty uses a
// native AXTabGroup of AXRadioButtons whose titles are those strings. SPEC §8.
// NOTE: avoid the `tab` keyword inside `tell process` — it shadows a UI-element
// class and throws -10000. Iterate windows by index with try/exit (list
// enumeration is also flaky), and delimit fields with "|||".
const GET_TABS = [
  'tell application "System Events"',
  '  tell process "Ghostty"',
  '    set out to ""',
  "    set wi to 1",
  "    repeat 12 times",
  "      try",
  "        set w to window wi",
  "        set tg to first tab group of w",
  "      on error",
  "        exit repeat",
  "      end try",
  "      set ti to 0",
  "      repeat with rb in (radio buttons of tg)",
  "        set ti to ti + 1",
  "        try",
  '          set out to out & (wi as text) & "|||" & (ti as text) & "|||" & (title of rb) & linefeed',
  "        end try",
  "      end repeat",
  "      set wi to wi + 1",
  "    end repeat",
  "    return out",
  "  end tell",
  "end tell",
].join("\n");

function selectTabScript(win: number, tab: number): string {
  return [
    'tell application "Ghostty" to activate',
    'tell application "System Events"',
    '  tell process "Ghostty"',
    `    set w to window ${win}`,
    '    perform action "AXRaise" of w',
    `    perform action "AXPress" of (radio button ${tab} of (first tab group of w))`,
    "  end tell",
    "end tell",
  ].join("\n");
}


export async function focusAgentTab(agent: Agent): Promise<boolean> {
  // Enumeration can hit a flaky System Events -10000; retry a few times.
  let raw = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      raw = await runAppleScript(GET_TABS);
      if (raw.trim()) break;
    } catch (e) {
      console.error(`[focus] GET_TABS attempt ${attempt} error: ${String(e).slice(0, 120)}`);
    }
  }
  const lines = raw.split("\n").filter((l) => l.includes("|||"));
  for (const line of lines) {
    const parts = line.split("|||");
    if (parts.length < 3) continue;
    const win = parseInt(parts[0], 10);
    const tab = parseInt(parts[1], 10);
    const title = parts.slice(2).join("|||");
    if (Number.isFinite(win) && Number.isFinite(tab) && agentMatchesTab(agent, title)) {
      try {
        await runAppleScript(selectTabScript(win, tab));
        return true;
      } catch {
        return false;
      }
    }
  }
  return false; // no tab matched → caller raises Ghostty
}

// Focus the agent's exact tab; fall back to just raising Ghostty if no match.
export async function focusOrRaise(agent: Agent): Promise<void> {
  const ok = await focusAgentTab(agent);
  if (!ok) await jumpToGhostty();
}

// Close the agent's Ghostty tab (focus it, then ⌘W).
export async function closeAgentTab(agent: Agent): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) return false;
  await runAppleScript('tell application "System Events" to keystroke "w" using {command down}');
  return true;
}

// Type a follow-up prompt into the agent's tab (focus it, then type + Return).
export async function nudgeAgent(agent: Agent, text: string): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) return false;
  await runAppleScript(
    ['tell application "System Events"', `  keystroke ${asStr(text)}`, "  key code 36", "end tell"].join("\n"),
  );
  return true;
}

export function resumeCommand(agent: Agent): string {
  return `cd ${shq(agent.cwd)} && claude --resume ${agent.sessionId}`;
}

// Open a folder in the configured editor (e.g. `code <path>`).
export async function openInEditor(path: string, editorCmd: string): Promise<void> {
  await run(editorCmd, [path]);
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

// Find the worktree (if any) that already has `branch` checked out.
async function worktreeForBranch(repoPath: string, branch: string): Promise<string | null> {
  try {
    const out = await run("git", ["-C", repoPath, "worktree", "list", "--porcelain"]);
    let path = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ") && line.slice("branch ".length).replace("refs/heads/", "") === branch)
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
    await run("gh", ["pr", "view", String(prNumber), "-R", repo, "--json", "headRefName", "-q", ".headRefName"], {
      cwd: repoPath,
    })
  ).trim();
  if (!branch) throw new Error("could not resolve PR branch");
  const task = `Working on PR #${prNumber}: ${title}`;

  const existing = await worktreeForBranch(repoPath, branch);
  if (existing) {
    // Branch already checked out — open the agent in that worktree.
    await openInGhosttyTab(existing, `claude ${shq(task)}`);
    return;
  }
  await run("claude-worktree", [branch], { cwd: repoPath, env: { CLAUDE_WT_PROMPT: task } });
}

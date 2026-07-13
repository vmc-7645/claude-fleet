// `→ Claude` actions: open a Ghostty tab running a command (resume / fork /
// review / spawn / undo), raise Ghostty, and stop an agent. Mirrors the
// AppleScript in claude-worktree/claude-restore (SPEC §8).

import { runAppleScript } from "@raycast/utils";
import { homedir } from "os";
import { Agent } from "./types";
import { run } from "./exec";
import { AgentTab, tabMatchScore } from "./tabmatch";

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

// Focus the exact Ghostty window/tab for an agent by matching its title (which
// the tab-status hook sets to "<emoji> <repo>[:<branch>] [— <task>]"). SPEC §8.
//
// We enumerate BOTH each window's title AND, when a window has a tab bar, each
// tab's title. A single-tab Ghostty window has NO AXTabGroup (and thus no radio
// buttons), so tabs-only enumeration misses it entirely — the window title is
// how we find those. Emit "W|||<win>|||0|||<title>" per window and
// "T|||<win>|||<tab>|||<title>" per tab.
//
// NOTE: avoid the `tab` keyword inside `tell process` — it shadows a UI-element
// class and throws -10000. `first tab group of w` throws for single-tab
// windows, so it's wrapped in its own try that must NOT abort the window loop.
// Each line carries a fullscreen flag ("1"/"0") so focus can switch Spaces for
// a native-fullscreen window. Fields: KIND|||win|||tab|||fs|||title.
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
  "      try",
  "        set tg to first tab group of w",
  "        set ti to 0",
  "        repeat with rb in (radio buttons of tg)",
  "          set ti to ti + 1",
  "          try",
  '            set out to out & "T|||" & (wi as text) & "|||" & (ti as text) & "|||" & fs & "|||" & (title of rb) & linefeed',
  "          end try",
  "        end repeat",
  "      end try",
  "    end repeat",
  "    return out",
  "  end tell",
  "end tell",
].join("\n");

// Focus a matched window/tab: make it the main window and raise it, press its
// tab's radio button when it's one of several, then activate Ghostty. A native-
// fullscreen window lives on its own Space, and activate/AXRaise do NOT switch
// Spaces to it — pressing the app's Dock tile does, reliably — so we finish
// with that only when the target is fullscreen.
function focusScript(win: number, tab: number | null, fullscreen: boolean): string {
  const lines = [
    'tell application "System Events"',
    '  tell process "Ghostty"',
    "    try",
    `      set value of attribute "AXMain" of window ${win} to true`,
    "    end try",
    `    perform action "AXRaise" of window ${win}`,
  ];
  if (tab !== null) {
    lines.push(`    perform action "AXPress" of (radio button ${tab} of (first tab group of window ${win}))`);
  }
  lines.push("  end tell", "end tell", 'tell application "Ghostty" to activate');
  if (fullscreen) {
    lines.push(
      'tell application "System Events"',
      '  tell process "Dock"',
      "    try",
      '      perform action "AXPress" of (first UI element of list 1 whose name is "Ghostty")',
      "    end try",
      "  end tell",
      "end tell",
    );
  }
  return lines.join("\n");
}

// The worktree's current branch — the strong, deterministic half of the match.
async function branchOf(cwd: string): Promise<string> {
  try {
    return (await run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    return "";
  }
}

export async function focusAgentTab(agent: Agent): Promise<boolean> {
  const id: AgentTab = { repo: agent.repo, branch: await branchOf(agent.cwd), task: agent.title };

  // Enumeration can hit a flaky System Events -10000; retry a few times.
  let raw = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      raw = await runAppleScript(ENUMERATE);
      if (raw.trim()) break;
    } catch (e) {
      console.error(`[focus] enumerate attempt ${attempt} error: ${String(e).slice(0, 120)}`);
    }
  }

  // Pick the highest-scoring title. On a tie, prefer a real tab ("T") over the
  // window-title fallback ("W") so a multi-tab window presses the exact tab.
  let best: { win: number; tab: number; kind: string; fs: boolean; score: number } | null = null;
  for (const line of raw.split("\n")) {
    if (!line.includes("|||")) continue;
    const parts = line.split("|||");
    if (parts.length < 5) continue;
    const kind = parts[0];
    const win = parseInt(parts[1], 10);
    const tab = parseInt(parts[2], 10);
    const fs = parts[3] === "1";
    const title = parts.slice(4).join("|||");
    if (!Number.isFinite(win) || !Number.isFinite(tab)) continue;
    const score = tabMatchScore(id, title);
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && kind === "T" && best.kind === "W")) {
      best = { win, tab, kind, fs, score };
    }
  }

  if (!best) return false; // no match → caller raises Ghostty
  try {
    await runAppleScript(focusScript(best.win, best.kind === "T" ? best.tab : null, best.fs));
    return true;
  } catch {
    return false;
  }
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

// Start a fresh Claude session in a repo (no worktree).
export async function newSessionInRepo(repoPath: string): Promise<void> {
  await openInGhosttyTab(repoPath, "claude");
}

// Open Claude's /mcp UI to (re)authenticate MCP servers.
export async function openMcpAuth(): Promise<void> {
  await openInGhosttyTab(homedir(), `claude ${shq("/mcp")}`);
}

// Run `claude doctor` in a tab.
export async function runDoctor(): Promise<void> {
  await openInGhosttyTab(homedir(), "claude doctor");
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

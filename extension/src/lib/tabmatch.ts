// Match a Claude agent to its Ghostty window/tab by title. The tab-status hook
// titles each tab "<emoji> <repo>[:<branch>] [— <task>]". Pure (no Raycast)
// so it's unit-testable. SPEC §8.
//
// The emoji is live state and must be ignored. Matching keys off "<repo>:<branch>"
// — one branch lives in exactly one worktree, so that fragment pins the tab
// deterministically, without depending on the (truncated, sometimes aiTitle-vs-
// prompt-mismatched) task text. Task agreement is only a tie-breaker.
//
// Fallback: a tab may instead show Claude Code's OWN title, "<glyph> <aiTitle>"
// (no repo:branch) — e.g. a session started before the tab-status hook was
// installed, or a moment when Claude re-asserted its title between hook events.
// Claude's title is verbatim the session aiTitle, which is also the agent title
// the extension uses for hook-less sessions, so we match the whole title body.

import { AgentState } from "./types";

export interface AgentTab {
  repo: string; // basename(cwd)
  branch?: string; // git branch of cwd, when known
  task?: string; // agent title (best-effort; may not be prompt-derived)
  state?: AgentState; // to disambiguate two agents sharing one repo:branch
}

// A Ghostty window/tab parsed from the AX enumeration.
export interface TabCandidate {
  kind: "T" | "W"; // real tab vs window-title fallback
  win: number;
  tab: number;
  fs: boolean; // fullscreen
  title: string;
}

function normTask(s?: string): string {
  return (s || "").replace(/…\s*$/, "").trim();
}

// The task portion of a tab title, after the " — " separator (em dash
// normally; en dash / spaced hyphen tolerated). Branch hyphens have no
// surrounding spaces, so they don't trip the split.
function tabTask(title: string): string {
  const m = title.match(/ [—–-] /);
  if (!m || m.index === undefined) return "";
  return normTask(title.slice(m.index + m[0].length));
}

// Both sides derive from the same prompt but truncate at different lengths
// (tab 40, agent title 60), so the shorter should prefix the longer.
function taskAgrees(a?: string, title?: string): boolean {
  const x = normTask(a);
  const y = tabTask(title || "");
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.startsWith(short);
}

// Repo/branch chars — used to reject substring hits (repo "app" inside
// "myapp:main"). The repo token must start at a non-identifier boundary.
function boundaryBefore(title: string, i: number): boolean {
  return i <= 0 || !/[A-Za-z0-9._/-]/.test(title[i - 1]);
}

function boundaryAfter(title: string, i: number): boolean {
  return i >= title.length || !/[A-Za-z0-9._/-]/.test(title[i]);
}

// Does `token` occur in `title` starting at a token boundary (so it's the repo,
// not the tail of a longer name)? With `endBounded`, the token must also end at
// a boundary (so branch "feat/a" doesn't match inside "feat/ab").
function includesToken(
  title: string,
  token: string,
  endBounded = false,
): boolean {
  for (let from = 0; ;) {
    const i = title.indexOf(token, from);
    if (i < 0) return false;
    if (
      boundaryBefore(title, i) &&
      (!endBounded || boundaryAfter(title, i + token.length))
    )
      return true;
    from = i + 1;
  }
}

// How strongly a Ghostty window/tab title identifies this agent. 0 = no match;
// higher = more specific. Callers pick the highest-scoring title.
export function tabMatchScore(a: AgentTab, title: string): number {
  const branch = (a.branch || "").trim();

  // Branch-precise: "<repo>:<branch>" uniquely identifies the worktree. This
  // matches even when the task text is missing or came from aiTitle, and even
  // for a single-tab window (whose title we also feed in).
  if (branch && includesToken(title, `${a.repo}:${branch}`, true)) {
    return taskAgrees(a.task, title) ? 4 : 3;
  }

  // No usable branch (detached HEAD, or the git lookup failed): fall back to
  // repo + task-prefix agreement — the original, fuzzier signal.
  const repoPresent =
    includesToken(title, `${a.repo}:`) ||
    includesToken(title, `${a.repo} `) ||
    (title.endsWith(a.repo) &&
      boundaryBefore(title, title.length - a.repo.length));
  if (repoPresent && taskAgrees(a.task, title)) return 2;

  // Last resort: the tab is Claude's own "<glyph> <aiTitle>" title with no
  // repo:branch. Match the whole body against the agent title. Strict (exact or
  // full-prefix, length-gated) since there's no repo to disambiguate.
  if (bodyAgrees(a.task, title)) return 1;

  return 0;
}

// Strip a leading status glyph / spinner (any run of non-letter/digit chars)
// to recover the aiTitle body from "<glyph> <aiTitle>".
function titleBody(title: string): string {
  return normTask(title.replace(/^[^\p{L}\p{N}]+/u, ""));
}

// Agreement for the no-repo fallback: exact, or one a full prefix of the other,
// with a high min length so unrelated titles can't collide.
function bodyAgrees(task: string | undefined, title: string): boolean {
  const x = normTask(task);
  const y = titleBody(title);
  if (x.length < 10 || y.length < 10) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.startsWith(short);
}

// Status emoji the tab-status hook uses per state. This is the only per-tab
// signal that distinguishes two agents sharing one repo:branch — they almost
// always differ in state (one working, one idle, …). (Per-tab recency isn't
// exposed by the accessibility API, so state is the achievable tie-breaker.)
const STATE_EMOJI: Record<AgentState, string> = {
  working: "⚙️",
  waiting: "🔔",
  done: "✅",
  idle: "💤",
};

function leadingEmojiMatches(title: string, state?: AgentState): boolean {
  if (!state) return false;
  return title.trimStart().startsWith(STATE_EMOJI[state]);
}

// A tab whose leading glyph marks it as an actively-working agent.
function isWorkingTab(title: string): boolean {
  return title.trimStart().startsWith(STATE_EMOJI.working);
}

// Pick the best-matching candidate for an agent, or null. Ranking:
//   1. highest tabMatchScore — task agreement already lifts repo:branch 3→4
//   2. leading status-emoji matches the agent's state — breaks the tie when two
//      tabs share repo:branch (and even task text)
//   3. a real tab ("T") over the window-title fallback ("W")
//   4. first seen
export function chooseTab(
  id: AgentTab,
  candidates: TabCandidate[],
): TabCandidate | null {
  let best: TabCandidate | null = null;
  let bestScore = 0;
  let bestEmoji = false;
  for (const c of candidates) {
    const score = tabMatchScore(id, c.title);
    if (score <= 0) continue;
    // When targeting a non-working agent, never land on an actively-working
    // agent's tab — several agents can share one repo:branch (same repo dir),
    // and the working one shouldn't win just because its title carries the
    // repo:branch while the target's shows Claude's own (aiTitle) title.
    if (id.state && id.state !== "working" && isWorkingTab(c.title)) continue;
    const emoji = leadingEmojiMatches(c.title, id.state);
    const wins =
      !best ||
      score > bestScore ||
      (score === bestScore && emoji && !bestEmoji) ||
      (score === bestScore &&
        emoji === bestEmoji &&
        c.kind === "T" &&
        best.kind === "W");
    if (wins) {
      best = c;
      bestScore = score;
      bestEmoji = emoji;
    }
  }
  return best;
}

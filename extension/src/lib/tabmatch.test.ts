import { describe, it, expect } from "vitest";
import { tabMatchScore, chooseTab, AgentTab, TabCandidate } from "./tabmatch";

// Real-world tab titles the tab-status hook / Claude Code produce.
const LIVE =
  "💤 myrepo:feat/arm-g474-port — Make ready for review please - then see …";

describe("tabMatchScore", () => {
  it("matches on repo:branch even when the task came from aiTitle", () => {
    expect(
      tabMatchScore(
        { repo: "myrepo", branch: "feat/arm-g474-port", task: "Port ARM" },
        LIVE,
      ),
    ).toBe(3);
  });

  it("scores higher when repo:branch AND task agree", () => {
    expect(
      tabMatchScore(
        {
          repo: "myrepo",
          branch: "feat/arm-g474-port",
          task: "Make ready for review please - then",
        },
        LIVE,
      ),
    ).toBe(4);
  });

  it("rejects a sibling worktree on a different branch", () => {
    expect(
      tabMatchScore(
        { repo: "myrepo", branch: "other-branch", task: "unrelated" },
        LIVE,
      ),
    ).toBe(0);
  });

  it("ignores the leading status emoji", () => {
    expect(
      tabMatchScore(
        { repo: "myrepo", branch: "feat/arm-g474-port", task: "x" },
        "⚙️ myrepo:feat/arm-g474-port — working",
      ),
    ).toBe(3);
  });

  it("does not match a repo that is a substring of another (app vs myapp)", () => {
    expect(
      tabMatchScore(
        { repo: "app", branch: "main", task: "do things now" },
        "🟢 myapp:main — do things now",
      ),
    ).toBe(0);
  });

  it("does not match a branch that is a prefix of another (feat/a vs feat/ab)", () => {
    expect(
      tabMatchScore(
        { repo: "r", branch: "feat/a", task: "" },
        "🟢 r:feat/ab — x",
      ),
    ).toBe(0);
    expect(
      tabMatchScore(
        { repo: "r", branch: "feat/a", task: "" },
        "🟢 r:feat/a — x",
      ),
    ).toBe(3);
  });

  it("falls back to repo + task when the branch is unknown (detached HEAD)", () => {
    expect(
      tabMatchScore(
        { repo: "myrepo", branch: "", task: "fix the parser bug" },
        "🟢 myrepo — fix the parser bug now",
      ),
    ).toBe(2);
  });

  it("matches Claude Code's own title (aiTitle, no repo:branch) as a last resort", () => {
    expect(
      tabMatchScore(
        { repo: "x", branch: "main", task: "Order items 348, 340, and 390" },
        "✳ Order items 348, 340, and 390",
      ),
    ).toBe(1);
  });

  it("does not false-match an unrelated aiTitle", () => {
    expect(
      tabMatchScore(
        { repo: "x", branch: "", task: "Add comments to code" },
        "⠐ Add comments and reviews",
      ),
    ).toBe(0);
  });
});

describe("chooseTab", () => {
  const cand = (
    title: string,
    extra: Partial<TabCandidate> = {},
  ): TabCandidate => ({
    kind: "T",
    win: 1,
    tab: 1,
    fs: false,
    title,
    ...extra,
  });

  it("returns null when nothing matches", () => {
    const id: AgentTab = { repo: "nope", branch: "none", task: "x" };
    expect(chooseTab(id, [cand("💤 other:main — whatever")])).toBeNull();
  });

  it("picks the higher score (own task agrees) among two same-branch tabs", () => {
    const id: AgentTab = {
      repo: "myrepo",
      branch: "feat/x",
      task: "Wire up the auth flow end to end",
    };
    const t1 = cand("⚙️ myrepo:feat/x — Wire up the auth flow end to end", {
      tab: 1,
    });
    const t2 = cand("💤 myrepo:feat/x — Totally different task here", {
      tab: 2,
    });
    expect(chooseTab(id, [t2, t1])?.tab).toBe(1); // t1 scores 4, t2 scores 3
  });

  it("disambiguates two identical-title tabs by the agent's state emoji", () => {
    // Same repo:branch AND same task text → scores tie; state emoji breaks it.
    const id: AgentTab = {
      repo: "myrepo",
      branch: "feat/x",
      task: "Shared task text here",
      state: "working",
    };
    const idle = cand("💤 myrepo:feat/x — Shared task text here", { tab: 1 });
    const working = cand("⚙️ myrepo:feat/x — Shared task text here", {
      tab: 2,
    });
    expect(chooseTab(id, [idle, working])?.tab).toBe(2); // agent is working → ⚙️ tab
  });

  it("prefers a real tab (T) over the window-title fallback (W) on a tie", () => {
    const id: AgentTab = { repo: "myrepo", branch: "feat/x", task: "same" };
    const w = cand("💤 myrepo:feat/x — same", { kind: "W", tab: 0 });
    const t = cand("💤 myrepo:feat/x — same", { kind: "T", tab: 3 });
    expect(chooseTab(id, [w, t])?.kind).toBe("T");
  });

  it("won't land on a working (⚙️) tab when the target agent isn't working", () => {
    // Two agents in the same repo dir: one working (its tab carries repo:branch,
    // score 3), the target is done (its tab shows Claude's own aiTitle, score 1).
    const id: AgentTab = {
      repo: "myrepo",
      branch: "main",
      task: "Review the parser fix",
      state: "done",
    };
    const working = cand("⚙️ myrepo:main — doing something else entirely", {
      tab: 1,
    });
    const done = cand("✳ Review the parser fix and merge", { tab: 2 });
    expect(chooseTab(id, [working, done])?.tab).toBe(2);
  });
});

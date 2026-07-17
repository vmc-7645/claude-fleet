import { describe, it, expect } from "vitest";
import {
  parseQuery,
  matchContext,
  searchContexts,
  snippetAround,
} from "./context-query";
import { ContextRecord } from "./contexts";

// Records shaped like the real index: a session spans several branches, and its
// text is what you and Claude actually said.
const rec = (extra: Partial<ContextRecord> = {}): ContextRecord => ({
  sessionId: "s1",
  path: "/p/s1.jsonl",
  root: "/Users/x/Dev/droyd2",
  repo: "droyd2",
  branches: ["main"],
  branch: "main",
  title: "Untitled",
  turns: 1,
  model: "claude-opus-4-8",
  updatedAt: 1000,
  messages: [],
  ...extra,
});

describe("parseQuery", () => {
  it("splits filter tokens out of the free text", () => {
    expect(parseQuery("branch:feat/yam repo:droyd2 retry backoff")).toEqual({
      terms: ["retry", "backoff"],
      branch: "feat/yam",
      repo: "droyd2",
    });
  });

  it("lowercases filter values so BRANCH:Main matches main", () => {
    expect(parseQuery("branch:Main").branch).toBe("main");
  });

  it("accepts a capitalized key (Branch: works like branch:)", () => {
    expect(parseQuery("Branch:main").branch).toBe("main");
    expect(parseQuery("IS:live").live).toBe(true);
  });

  it("treats a bare key: with no value as text (user mid-type)", () => {
    expect(parseQuery("branch:")).toEqual({ terms: ["branch:"] });
  });

  it("maps is:live and is:idle to the live flag", () => {
    expect(parseQuery("is:live").live).toBe(true);
    expect(parseQuery("is:idle").live).toBe(false);
  });

  it("keeps an unknown is:… as text rather than silently ignoring it", () => {
    expect(parseQuery("is:banana").terms).toEqual(["is:banana"]);
  });

  it("returns no terms for an empty query", () => {
    expect(parseQuery("   ").terms).toEqual([]);
  });

  it("keeps a quoted value with a space intact (repo dirs may have spaces)", () => {
    expect(parseQuery('repo:"My Project"')).toEqual({
      terms: [],
      repo: "my project",
    });
  });

  it("treats a quoted run as one term (phrase search)", () => {
    expect(parseQuery('"retry backoff"').terms).toEqual(["retry backoff"]);
  });

  it("keeps a value containing a colon (branch:feat:x)", () => {
    expect(parseQuery("branch:feat:x").branch).toBe("feat:x");
  });
});

describe("matchContext", () => {
  it("ANDs multiple words instead of matching them as one phrase", () => {
    // The regression that mattered: "retry backoff" must find a message that
    // says "add retry with backoff please".
    const r = rec({
      messages: [{ role: "u", text: "add retry with backoff" }],
    });
    expect(matchContext(parseQuery("retry backoff"), r)).not.toBeNull();
    expect(matchContext(parseQuery("backoff retry"), r)).not.toBeNull();
  });

  it("ANDs across a newline", () => {
    const r = rec({ messages: [{ role: "u", text: "retry\nbackoff" }] });
    expect(matchContext(parseQuery("retry backoff"), r)).not.toBeNull();
  });

  it("requires every term — one miss excludes the row", () => {
    const r = rec({ messages: [{ role: "u", text: "add retry" }] });
    expect(matchContext(parseQuery("retry zebra"), r)).toBeNull();
  });

  it("a quoted phrase still demands the exact run", () => {
    const r = rec({
      messages: [{ role: "u", text: "add retry with backoff" }],
    });
    expect(matchContext(parseQuery('"retry backoff"'), r)).toBeNull();
    expect(matchContext(parseQuery('"retry with backoff"'), r)).not.toBeNull();
  });

  it("ranks one message holding every term above terms scattered across the session", () => {
    const together = rec({
      messages: [{ role: "a", text: "retry and backoff" }],
    });
    const apart = rec({
      messages: [
        { role: "u", text: "retry" },
        { role: "u", text: "backoff" },
      ],
    });
    const a = matchContext(parseQuery("retry backoff"), together)!;
    const b = matchContext(parseQuery("retry backoff"), apart)!;
    expect(a.score).toBeGreaterThan(b.score);
    expect(b).not.toBeNull(); // but scattered still counts
  });

  it("counts a term found in the title toward the AND", () => {
    const r = rec({
      title: "retry",
      messages: [{ role: "u", text: "backoff" }],
    });
    expect(matchContext(parseQuery("retry backoff"), r)).not.toBeNull();
  });

  it("matches a branch the session touched but did not end on", () => {
    // 84 of 237 real sessions span >1 branch; filtering on the final branch
    // alone would hide them.
    const r = rec({
      branches: ["main", "feat/wrist-ik"],
      branch: "feat/wrist-ik",
    });
    expect(matchContext(parseQuery("branch:main"), r)).not.toBeNull();
  });

  it("does not match a branch that is a prefix of another (feat vs feat/wrist-ik)", () => {
    const r = rec({ branches: ["feat/wrist-ik"], branch: "feat/wrist-ik" });
    expect(matchContext(parseQuery("branch:feat"), r)).toBeNull();
  });

  it("excludes a row when a filter misses even if the text hits", () => {
    const r = rec({
      repo: "droyd2",
      messages: [{ role: "u", text: "retry backoff" }],
    });
    expect(matchContext(parseQuery("repo:other retry"), r)).toBeNull();
  });

  it("returns every filtered row when there is no free text", () => {
    const m = matchContext(parseQuery("repo:droyd2"), rec());
    expect(m?.where).toBe("meta");
  });

  it("ranks a title hit above a message hit", () => {
    const title = rec({ title: "retry backoff" });
    const msg = rec({ messages: [{ role: "u", text: "retry backoff" }] });
    const a = matchContext(parseQuery("retry"), title)!;
    const b = matchContext(parseQuery("retry"), msg)!;
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("ranks what you asked above what Claude answered", () => {
    const asked = rec({ messages: [{ role: "u", text: "add retry" }] });
    const said = rec({ messages: [{ role: "a", text: "add retry" }] });
    const a = matchContext(parseQuery("retry"), asked)!;
    const b = matchContext(parseQuery("retry"), said)!;
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("is case-insensitive across title and messages", () => {
    expect(
      matchContext(
        parseQuery("RETRY backoff"),
        rec({ title: "Retry Backoff" }),
      ),
    ).not.toBeNull();
  });

  it("carries a snippet for a message hit and none for a title hit", () => {
    const msg = rec({
      messages: [{ role: "u", text: "please add retry backoff here" }],
    });
    expect(matchContext(parseQuery("retry"), msg)!.snippet).toContain("retry");
    expect(matchContext(parseQuery("untitled"), rec())!.snippet).toBe("");
  });

  it("filters on live state", () => {
    expect(
      matchContext(parseQuery("is:live"), rec({ live: true })),
    ).not.toBeNull();
    expect(
      matchContext(parseQuery("is:live"), rec({ live: false })),
    ).toBeNull();
  });

  it("treats regex metacharacters as literal text", () => {
    const r = rec({ messages: [{ role: "u", text: "cost is a.*b dollars" }] });
    expect(matchContext(parseQuery("a.*b"), r)).not.toBeNull();
    expect(matchContext(parseQuery("axxb"), r)).toBeNull();
  });
});

describe("snippetAround", () => {
  it("ellipses only the side that was actually cut", () => {
    // Hit at index 0: nothing was cut on the left, so no leading ellipsis.
    expect(snippetAround("retry" + "x".repeat(200), "retry")).toBe(
      `retry${"x".repeat(70)}…`,
    );
  });

  it("collapses whitespace so a snippet stays on one line", () => {
    expect(snippetAround("add\n\n  retry   now", "retry")).toBe(
      "add retry now",
    );
  });

  it("returns empty when the needle is absent", () => {
    expect(snippetAround("nothing here", "retry")).toBe("");
  });
});

describe("searchContexts", () => {
  it("orders by score then recency", () => {
    const old = rec({ sessionId: "old", title: "retry", updatedAt: 1 });
    const fresh = rec({ sessionId: "fresh", title: "retry", updatedAt: 9 });
    const weak = rec({
      sessionId: "weak",
      messages: [{ role: "a", text: "retry" }],
    });
    const got = searchContexts("retry", [old, weak, fresh]).map(
      (m) => m.rec.sessionId,
    );
    expect(got).toEqual(["fresh", "old", "weak"]);
  });

  it("returns everything for an empty query", () => {
    expect(searchContexts("", [rec(), rec()])).toHaveLength(2);
  });

  it("finds a row via the quoted value the dropdown injects", () => {
    const r = rec({ repo: "My Project", root: "/Users/x/Dev/My Project" });
    expect(searchContexts('repo:"My Project"', [r])).toHaveLength(1);
  });
});

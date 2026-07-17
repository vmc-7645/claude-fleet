import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Guard against leaking a real (possibly private) repo name into committed test
// fixtures — as happened once. Test fixtures must use generic placeholder repo
// names; if you add a new placeholder, allow it here. A real repo slipping in
// (e.g. "acme-corp") trips this with a clear message instead of shipping.
const ALLOWED = new Set([
  "myrepo",
  "otherrepo",
  "myapp",
  "app",
  "other",
  "nope",
  "unrelated",
  "elsewhere",
  "acme",
  "widgets",
  "solo",
  "r",
  "x",
  "repo", // the `repo:` field label, not a repo name
]);

const FILES = ["tabmatch.test.ts", "ghostty.test.ts", "gh.test.ts"];

// Pull repo-name tokens out of fixture source: `repo: "<t>"`, a `<t>:<branch>`
// title prefix (colon immediately followed by the branch — so "Epic: foo" isn't
// caught), and `owner/name` slugs.
function repoTokens(src: string): Set<string> {
  const out = new Set<string>();
  // `repo: "<t>"` field value.
  for (const m of src.matchAll(/\brepo:\s*"([a-zA-Z0-9._-]+)"/g)) out.add(m[1]);
  // `<repo>:<branch>` at a tab-title's start (colon immediately followed by the
  // branch, so a plain "Epic: foo" isn't caught, and branch slugs like "feat/x"
  // — which have no colon — aren't mistaken for repos).
  for (const m of src.matchAll(/[\s("]([a-z][a-z0-9._-]*):[a-z0-9]/g))
    out.add(m[1]);
  // gh JSON fixtures carry the repo as `nameWithOwner: "owner/name"`.
  for (const m of src.matchAll(
    /nameWithOwner"?\s*:\s*"([a-z0-9-]+)\/([a-z0-9-]+)"/g,
  )) {
    out.add(m[1]);
    out.add(m[2]);
  }
  return out;
}

describe("fixture hygiene — no real repo names", () => {
  for (const f of FILES) {
    it(`${f} references only placeholder repos`, () => {
      const src = readFileSync(join(process.cwd(), "src", "lib", f), "utf8");
      const bad = [...repoTokens(src)].filter((t) => !ALLOWED.has(t));
      expect(
        bad,
        `real-looking repo token(s) in ${f}: ${bad.join(", ")} — use a placeholder (see ALLOWED)`,
      ).toEqual([]);
    });
  }
});

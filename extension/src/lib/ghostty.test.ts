import { describe, it, expect } from "vitest";
import { chooseTargetWindow, GWindow, titleHasRepo } from "./tabmatch";

const win = (index: number, titles: string[]): GWindow => ({
  index,
  title: titles[0] ?? "",
  fs: false,
  tabs: titles.map((t, i) => ({ index: i + 1, title: t })),
});

describe("titleHasRepo", () => {
  it("matches repo:branch and repo — task titles", () => {
    expect(titleHasRepo("💤 myrepo:docs/x — Fix all", "myrepo")).toBe(true);
    expect(titleHasRepo("⚙️ myrepo — do things", "myrepo")).toBe(true);
  });
  it("matches a bare trailing repo (hook-less tab)", () => {
    expect(titleHasRepo("🟢 myrepo", "myrepo")).toBe(true);
  });
  it("does not match a repo that is a substring of another", () => {
    expect(titleHasRepo("🟢 myapp:main — x", "app")).toBe(false);
  });
  it("does not match an unrelated aiTitle", () => {
    expect(titleHasRepo("✳ Order items 348, 340", "myrepo")).toBe(false);
  });
});

describe("chooseTargetWindow", () => {
  it("returns null when there are no windows (caller opens a new one)", () => {
    expect(chooseTargetWindow([], "myrepo")).toBeNull();
  });

  it("prefers the window already hosting the same project", () => {
    const w1 = win(1, ["💤 other:main — a"]);
    const w2 = win(2, ["⚙️ myrepo:docs/x — b", "💤 myrepo:docs/y — c"]);
    expect(chooseTargetWindow([w1, w2], "myrepo")?.index).toBe(2);
  });

  it("falls back to the frontmost window when no project match", () => {
    const w1 = win(1, ["💤 other:main — a"]);
    const w2 = win(2, ["⚙️ nope:main — b"]);
    expect(chooseTargetWindow([w1, w2], "myrepo")?.index).toBe(1);
  });

  it("picks the frontmost among several windows hosting the project", () => {
    const w1 = win(1, ["💤 unrelated:main — a"]);
    const w2 = win(2, ["⚙️ myrepo:docs/x — b"]);
    const w3 = win(3, ["💤 myrepo:docs/z — c"]);
    expect(chooseTargetWindow([w1, w2, w3], "myrepo")?.index).toBe(2);
  });

  it("matches the project via a single-tab window's own title (no tab bar)", () => {
    const w1 = win(1, ["💤 elsewhere:main — a"]);
    const bare: GWindow = {
      index: 2,
      title: "💤 myrepo:docs/x — solo",
      fs: false,
      tabs: [],
    };
    expect(chooseTargetWindow([w1, bare], "myrepo")?.index).toBe(2);
  });

  it("reuses the frontmost window when repo is empty", () => {
    const w1 = win(1, ["a"]);
    const w2 = win(2, ["b"]);
    expect(chooseTargetWindow([w1, w2], "")?.index).toBe(1);
  });
});

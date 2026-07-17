import { describe, it, expect } from "vitest";
import {
  findTabGroup,
  ENUMERATE,
  COUNT_SURFACES,
  dockPressScript,
  raiseWindowScript,
  focusScript,
} from "./ghostty-script";

// These builders encode fiddly AppleScript that's easy to regress. Snapshots lock
// the exact output; the assertions document WHY each shape matters.

describe("findTabGroup", () => {
  it("searches depth 0 then depth 1 (fullscreen nesting)", () => {
    const s = findTabGroup("window 5").join("\n");
    expect(s).toContain("set tg to first tab group of window 5"); // depth 0
    expect(s).toContain("UI elements of window 5"); // depth 1 fallback
  });
});

describe("ENUMERATE", () => {
  it("emits both window (W) and tab (T) rows with a fullscreen flag", () => {
    expect(ENUMERATE).toContain('"W|||"');
    expect(ENUMERATE).toContain('"T|||"');
    expect(ENUMERATE).toContain("AXFullScreen");
    // Uses the nested tab-group search, not a bare `first tab group of w`.
    expect(ENUMERATE).toContain("UI elements of w");
  });
  it("never uses the bare `tab` keyword (it shadows a UI class, -10000)", () => {
    expect(/\btab\b/.test(ENUMERATE.replace(/tab group|tab bar/g, ""))).toBe(
      false,
    );
  });
});

describe("COUNT_SURFACES", () => {
  it("counts a single-tab window as 1 and otherwise sums radio buttons", () => {
    expect(COUNT_SURFACES).toContain("set n to n + 1");
    expect(COUNT_SURFACES).toContain("count of radio buttons of tg");
    // Uses the same depth-0/1 nested tab-group search as enumeration.
    expect(COUNT_SURFACES).toContain("UI elements of w");
    // Returns just the number, not per-tab titles.
    expect(COUNT_SURFACES).toContain("return n");
    expect(COUNT_SURFACES).not.toContain("title of");
  });
});

describe("dockPressScript", () => {
  it("presses Ghostty's Dock tile", () => {
    expect(dockPressScript().join("\n")).toMatchInlineSnapshot(`
      "tell application "System Events"
        tell process "Dock"
          try
            perform action "AXPress" of (first UI element of list 1 whose name is "Ghostty")
          end try
        end tell
      end tell"
    `);
  });
});

describe("raiseWindowScript", () => {
  it("no Dock-press when no Space switch is needed", () => {
    const s = raiseWindowScript(1, false).join("\n");
    expect(s).not.toContain("Dock");
    expect(s).toContain('"AXMain" of window 1');
  });
  it("appends the Dock-press when a Space switch is needed", () => {
    expect(raiseWindowScript(3, true).join("\n")).toMatchInlineSnapshot(`
      "tell application "System Events"
        tell process "Ghostty"
          try
            set value of attribute "AXMain" of window 3 to true
          end try
          perform action "AXRaise" of window 3
        end tell
      end tell
      tell application "Ghostty" to activate
      tell application "System Events"
        tell process "Dock"
          try
            perform action "AXPress" of (first UI element of list 1 whose name is "Ghostty")
          end try
        end tell
      end tell"
    `);
  });
});

describe("focusScript", () => {
  it("presses the tab's radio button when tab is given", () => {
    const s = focusScript(2, 4, false).join("\n");
    expect(s).toContain("radio button 4 of tg");
    expect(s).not.toContain("Dock");
  });
  it("omits the radio-button press for a single-tab window (tab null)", () => {
    const s = focusScript(2, null, false).join("\n");
    expect(s).not.toContain("radio button");
  });
  it("full script for a background/fullscreen tab (with Space switch)", () => {
    expect(focusScript(3, 2, true).join("\n")).toMatchInlineSnapshot(`
      "tell application "System Events"
        tell process "Ghostty"
          try
            set value of attribute "AXMain" of window 3 to true
          end try
          perform action "AXRaise" of window 3
          set tg to missing value
          try
            set tg to first tab group of window 3
          end try
          if tg is missing value then
            repeat with g in (UI elements of window 3)
              try
                set tg to first tab group of g
                exit repeat
              end try
            end repeat
          end if
          if tg is not missing value then
            try
              perform action "AXPress" of (radio button 2 of tg)
            end try
          end if
        end tell
      end tell
      tell application "Ghostty" to activate
      tell application "System Events"
        tell process "Dock"
          try
            perform action "AXPress" of (first UI element of list 1 whose name is "Ghostty")
          end try
        end tell
      end tell"
    `);
  });
});

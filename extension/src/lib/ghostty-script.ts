// Pure AppleScript builders for driving Ghostty via Accessibility. No Raycast
// imports, so they're snapshot-testable — these strings encode fiddly, easy-to-
// regress details (the `tab`-keyword -10000 shadow, the fullscreen depth-0/1 tab-
// group nesting, the Dock-press Space switch). ghostty.ts runs them. SPEC §8.

// Find a window's tab group and bind it to `tg` (missing value if none). In a
// normal window the AXTabGroup is a direct child; in a NATIVE-FULLSCREEN window
// Ghostty nests it one level deeper (window → AXGroup → AXTabGroup), so a plain
// `first tab group of w` finds nothing and every background tab becomes
// invisible. Search depth 0, then depth 1. `wref` is the window expression.
export function findTabGroup(wref: string): string[] {
  return [
    "    set tg to missing value",
    "    try",
    `      set tg to first tab group of ${wref}`,
    "    end try",
    "    if tg is missing value then",
    `      repeat with g in (UI elements of ${wref})`,
    "        try",
    "          set tg to first tab group of g",
    "          exit repeat",
    "        end try",
    "      end repeat",
    "    end if",
  ];
}

// NOTE: avoid the `tab` keyword inside `tell process` — it shadows a UI-element
// class and throws -10000. Each line carries a fullscreen flag ("1"/"0") so
// focus can switch Spaces for a native-fullscreen window. Fields:
// KIND|||win|||tab|||fs|||title. We enumerate BOTH each window's title AND, when
// a window has a tab bar, each tab's title. A single-tab Ghostty window has NO
// AXTabGroup, so tabs-only enumeration misses it entirely — the window title is
// how we find those.
export const ENUMERATE = [
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
  ...findTabGroup("w"),
  "      if tg is not missing value then",
  "        set ti to 0",
  "        repeat with rb in (radio buttons of tg)",
  "          set ti to ti + 1",
  "          try",
  '            set out to out & "T|||" & (wi as text) & "|||" & (ti as text) & "|||" & fs & "|||" & (title of rb) & linefeed',
  "          end try",
  "        end repeat",
  "      end if",
  "    end repeat",
  "    return out",
  "  end tell",
  "end tell",
].join("\n");

// Count terminal surfaces (tabs; a single-tab window with no tab group = 1) and
// return just the number. Used as the ⌘T/⌘N readiness poll — far lighter than
// enumerating every window/tab title.
export const COUNT_SURFACES = [
  'tell application "System Events"',
  '  tell process "Ghostty"',
  "    set n to 0",
  "    repeat with wi from 1 to (count of windows)",
  "      set w to window wi",
  ...findTabGroup("w"),
  "      if tg is missing value then",
  "        set n to n + 1",
  "      else",
  "        set n to n + (count of radio buttons of tg)",
  "      end if",
  "    end repeat",
  "    return n",
  "  end tell",
  "end tell",
].join("\n");

// Press Ghostty's Dock tile — the reliable way to switch Spaces to its main
// window (activate/AXRaise do not cross Spaces).
export function dockPressScript(): string[] {
  return [
    'tell application "System Events"',
    '  tell process "Dock"',
    "    try",
    '      perform action "AXPress" of (first UI element of list 1 whose name is "Ghostty")',
    "    end try",
    "  end tell",
    "end tell",
  ];
}

// Bring a window forward so a subsequent ⌘T lands in it. A native-fullscreen
// window (or any background window, which may sit on another Space) is not
// reached by activate/AXRaise alone — finish with the Dock-press when a Space
// switch may be needed.
export function raiseWindowScript(win: number, spaceSwitch: boolean): string[] {
  const lines = [
    'tell application "System Events"',
    '  tell process "Ghostty"',
    "    try",
    `      set value of attribute "AXMain" of window ${win} to true`,
    "    end try",
    `    perform action "AXRaise" of window ${win}`,
    "  end tell",
    "end tell",
    'tell application "Ghostty" to activate',
  ];
  if (spaceSwitch) lines.push(...dockPressScript());
  return lines;
}

// Focus a matched window/tab: raise the window, press its tab's radio button
// when it's one of several, activate Ghostty, and switch Spaces (Dock-press) if
// needed. `spaceSwitch` should be true for a fullscreen target OR any background
// window (win !== 1), since a background window may live on another Space.
export function focusScript(
  win: number,
  tab: number | null,
  spaceSwitch: boolean,
): string[] {
  const lines = [
    'tell application "System Events"',
    '  tell process "Ghostty"',
    "    try",
    `      set value of attribute "AXMain" of window ${win} to true`,
    "    end try",
    `    perform action "AXRaise" of window ${win}`,
  ];
  if (tab !== null) {
    lines.push(
      ...findTabGroup(`window ${win}`),
      "    if tg is not missing value then",
      "      try",
      `        perform action "AXPress" of (radio button ${tab} of tg)`,
      "      end try",
      "    end if",
    );
  }
  lines.push(
    "  end tell",
    "end tell",
    'tell application "Ghostty" to activate',
  );
  if (spaceSwitch) lines.push(...dockPressScript());
  return lines;
}

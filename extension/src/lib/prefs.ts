import { getPreferenceValues } from "@raycast/api";

export interface Prefs {
  editorCommand?: string;
  reposRoot?: string;
  primaryClick?: "focus" | "resume";
  terminalApp?: "ghostty" | "iterm" | "terminal";
  quickReplies?: string;
  tabOpenMode?: "tab" | "window";
  tabOpenDelay?: string; // seconds; textfield, parsed to a number
  stuckMinutes?: string; // minutes; a working agent stale this long is flagged
}

export function prefs(): Prefs {
  return getPreferenceValues<Prefs>();
}

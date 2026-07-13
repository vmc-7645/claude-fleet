import { getPreferenceValues } from "@raycast/api";

export interface Prefs {
  editorCommand?: string;
  reposRoot?: string;
  primaryClick?: "focus" | "resume";
  terminalApp?: "ghostty" | "iterm" | "terminal";
  quickReplies?: string;
}

export function prefs(): Prefs {
  return getPreferenceValues<Prefs>();
}

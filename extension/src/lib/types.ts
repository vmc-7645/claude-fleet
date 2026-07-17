// The unified agent shape the UI renders. Active agents come from Claude's own
// session registry (~/.claude/sessions), refined by the optional fleet hook
// (~/.claude/fleet); recent ones from transcript history (~/.claude/projects).
// See SPEC §6.

export type AgentState = "working" | "waiting" | "done" | "idle";

export interface Agent {
  sessionId: string;
  // The transcript backing this agent, when it has one. Carried so Delete acts
  // on the exact file the row was built from — a sessionId can't identify a
  // transcript (see history.ts deleteTranscriptAt).
  transcriptPath?: string;
  cwd: string;
  repo: string;
  title: string; // fleet task > aiTitle > derived name
  live: boolean; // true = active (in Claude's session registry)
  state: AgentState;
  stateReason?: string; // permission tool while waiting
  diff?: string; // git diff --shortstat, when known
  lastTool?: string; // last tool + target while working
  mode?: string; // permission mode: default | plan | acceptEdits | bypassPermissions
  question?: string; // last assistant message (the pending ask)
  pid?: number;
  updatedAt: number; // epoch ms
  turns?: number; // recent only
}

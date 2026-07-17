// The unified agent shape the UI renders. Active agents come from Claude's own
// session registry (~/.claude/sessions), refined by the optional fleet hook
// (~/.claude/fleet); recent ones from transcript history (~/.claude/projects).
// See SPEC §6.

export type AgentState = "working" | "waiting" | "done" | "idle";

// Claude's registry says busy/not; when it isn't busy, the fleet hook (if
// present) says which kind of idle. The hook's `state` is an arbitrary string
// off disk, so it's allowlisted rather than trusted — an unrecognized value
// means "idle", never a bogus AgentState. Shared so every surface reads a
// session's state the same way (SPEC §6.1a).
export function liveState(busy: boolean, fleetState?: string): AgentState {
  if (busy) return "working";
  if (
    fleetState === "waiting" ||
    fleetState === "done" ||
    fleetState === "idle"
  )
    return fleetState;
  return "idle";
}

export interface Agent {
  sessionId: string;
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

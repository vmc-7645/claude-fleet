// The unified agent shape the UI renders. Active agents come from Claude's own
// session registry (~/.claude/sessions); recent ones from transcript history
// (~/.claude/projects). See SPEC §6.

export type AgentState = "working" | "idle";

export interface Agent {
  sessionId: string;
  cwd: string;
  repo: string;
  title: string; // aiTitle (preferred) or a derived name
  live: boolean; // true = active (in Claude's session registry)
  state: AgentState; // active: busy->working / idle; recent: idle
  pid?: number;
  updatedAt: number; // epoch ms (active: registry updatedAt; recent: file mtime)
  turns?: number; // recent only
}

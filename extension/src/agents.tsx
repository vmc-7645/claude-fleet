// Agents — the console. Merges Claude's live session registry (Active) with
// transcript history (Recent). Each row obeys the `→ Claude` primitive:
// resume / fork / jump. SPEC §5.1.

import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
  open,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { loadAgents } from "./lib/rank";
import { Agent } from "./lib/types";
import { resumeAgent, forkAgent, jumpToGhostty } from "./lib/claude";

function timeAgo(ms: number): string {
  if (!ms) return "";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function agentIcon(a: Agent): string {
  if (!a.live) return "🕘";
  return a.state === "working" ? "⚙️" : "✅";
}

export default function Command() {
  const [active, setActive] = useState<Agent[]>([]);
  const [recent, setRecent] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function refresh() {
    try {
      const r = loadAgents();
      setActive(r.active);
      setRecent(r.recent);
    } catch (e) {
      showToast({ style: Toast.Style.Failure, title: "Failed to load agents", message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  const empty = !isLoading && active.length === 0 && recent.length === 0;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search agents by repo or title…">
      {empty && (
        <List.EmptyView icon="🤖" title="No Claude agents" description="Start one and it'll appear here." />
      )}
      <List.Section title={`Active (${active.length})`}>
        {active.map((a) => (
          <AgentItem key={a.sessionId} agent={a} onRefresh={refresh} />
        ))}
      </List.Section>
      <List.Section title={`Recent (${recent.length})`}>
        {recent.map((a) => (
          <AgentItem key={a.sessionId} agent={a} onRefresh={refresh} />
        ))}
      </List.Section>
    </List>
  );
}

function AgentItem({ agent, onRefresh }: { agent: Agent; onRefresh: () => void }) {
  const age = agent.live
    ? `${agent.state === "working" ? "working" : "idle"} ${timeAgo(agent.updatedAt)}`
    : `${timeAgo(agent.updatedAt)}${agent.turns ? ` · ${agent.turns} turns` : ""}`;

  async function run(fn: () => Promise<void>, hud: string) {
    try {
      await fn();
      await showHUD(hud);
      await closeMainWindow();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Action failed", message: String(e) });
    }
  }

  return (
    <List.Item
      icon={agentIcon(agent)}
      title={agent.repo}
      subtitle={agent.title}
      accessories={[{ text: age }]}
      actions={
        <ActionPanel>
          {agent.live ? (
            <>
              <Action title="Jump to Ghostty" icon={Icon.Window} onAction={() => run(jumpToGhostty, "Raised Ghostty")} />
              <Action
                title="Resume in New Tab"
                icon={Icon.Terminal}
                onAction={() => run(() => resumeAgent(agent), `Resuming ${agent.repo}`)}
              />
            </>
          ) : (
            <>
              <Action
                title="Resume in New Tab"
                icon={Icon.Terminal}
                onAction={() => run(() => resumeAgent(agent), `Resuming ${agent.repo}`)}
              />
              <Action
                title="Fork Session"
                icon={Icon.Duplicate}
                onAction={() => run(() => forkAgent(agent), `Forking ${agent.repo}`)}
              />
            </>
          )}
          <Action title="Open Folder" icon={Icon.Folder} onAction={() => open(agent.cwd)} />
          <Action.CopyToClipboard title="Copy Session ID" content={agent.sessionId} />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={onRefresh}
          />
        </ActionPanel>
      }
    />
  );
}

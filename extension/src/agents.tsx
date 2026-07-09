// Agents — the console. Active (Claude's live registry + fleet hook) + Recent
// (transcript history). Each row obeys `→ Claude`. SPEC §5.1.

import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
  open,
  confirmAlert,
  Alert,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { loadAgents } from "./lib/rank";
import { cleanupStaleFleet } from "./lib/fleet";
import { Agent, AgentState } from "./lib/types";
import { resumeAgent, forkAgent, jumpToGhostty, openUndo, stopAgent } from "./lib/claude";

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
  switch (a.state) {
    case "working":
      return "⚙️";
    case "waiting":
      return "🔔";
    case "done":
      return "✅";
    default:
      return "💤";
  }
}

function modeLabel(mode?: string): string | undefined {
  switch (mode) {
    case "plan":
      return "plan";
    case "acceptEdits":
      return "auto-edit";
    case "bypassPermissions":
      return "bypass";
    case "default":
    case undefined:
    case "":
      return undefined;
    default:
      return mode;
  }
}

export default function Command() {
  const [active, setActive] = useState<Agent[]>([]);
  const [recent, setRecent] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);

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

  async function cleanUp() {
    const keep = new Set<string>([...active, ...recent].map((a) => a.sessionId));
    const n = cleanupStaleFleet(keep);
    await showToast({ style: Toast.Style.Success, title: `Cleaned up ${n} stale fleet file(s)` });
  }

  const empty = !isLoading && active.length === 0 && recent.length === 0;

  const shared = {
    onRefresh: refresh,
    showDetail,
    toggleDetail: () => setShowDetail((v) => !v),
    cleanUp,
  };

  return (
    <List isLoading={isLoading} isShowingDetail={showDetail} searchBarPlaceholder="Search agents by repo or title…">
      {empty && <List.EmptyView icon="🤖" title="No Claude agents" description="Start one and it'll appear here." />}
      <List.Section title={`Active (${active.length})`}>
        {active.map((a) => (
          <AgentItem key={a.sessionId} agent={a} {...shared} />
        ))}
      </List.Section>
      <List.Section title={`Recent (${recent.length})`}>
        {recent.map((a) => (
          <AgentItem key={a.sessionId} agent={a} {...shared} />
        ))}
      </List.Section>
    </List>
  );
}

function AgentItem(props: {
  agent: Agent;
  onRefresh: () => void;
  showDetail: boolean;
  toggleDetail: () => void;
  cleanUp: () => Promise<void>;
}) {
  const { agent, onRefresh, showDetail, toggleDetail, cleanUp } = props;
  const mode = modeLabel(agent.mode);

  const ageLabel = agent.live
    ? `${agent.state} · ${timeAgo(agent.updatedAt)}`
    : `${timeAgo(agent.updatedAt)}${agent.turns ? ` · ${agent.turns}t` : ""}`;

  const accessories: List.Item.Accessory[] = [];
  if (mode) accessories.push({ tag: { value: mode, color: Color.Purple } });
  if (agent.state === "waiting" && agent.stateReason) {
    accessories.push({ tag: { value: agent.stateReason, color: Color.Orange } });
  } else if (agent.state === "working" && agent.lastTool) {
    accessories.push({ text: agent.lastTool });
  } else if (agent.diff) {
    accessories.push({ text: agent.diff });
  }
  accessories.push({ text: ageLabel });

  async function act(fn: () => Promise<void>, hud: string) {
    try {
      await fn();
      await showHUD(hud);
      await closeMainWindow();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Action failed", message: String(e) });
    }
  }

  async function doStop() {
    if (!agent.pid) return;
    const ok = await confirmAlert({
      title: `Stop ${agent.repo}?`,
      message: "Sends Ctrl-C (SIGINT) to the agent's current work.",
      primaryAction: { title: "Stop", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    try {
      stopAgent(agent.pid);
      await showToast({ style: Toast.Style.Success, title: `Sent stop to ${agent.repo}` });
      onRefresh();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Stop failed", message: String(e) });
    }
  }

  const detail = (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Repo" text={agent.repo} />
          <List.Item.Detail.Metadata.Label title="State" text={agent.state} />
          {mode && <List.Item.Detail.Metadata.Label title="Mode" text={mode} />}
          {agent.title && <List.Item.Detail.Metadata.Label title="Task" text={agent.title} />}
          {agent.stateReason && <List.Item.Detail.Metadata.Label title="Waiting on" text={agent.stateReason} />}
          {agent.lastTool && <List.Item.Detail.Metadata.Label title="Last tool" text={agent.lastTool} />}
          {agent.diff && <List.Item.Detail.Metadata.Label title="Diff" text={agent.diff} />}
          {agent.turns ? <List.Item.Detail.Metadata.Label title="Turns" text={String(agent.turns)} /> : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Path" text={agent.cwd} />
          <List.Item.Detail.Metadata.Label title="Session" text={agent.sessionId} />
        </List.Item.Detail.Metadata>
      }
    />
  );

  return (
    <List.Item
      icon={agentIcon(agent)}
      title={agent.repo}
      subtitle={showDetail ? undefined : agent.title}
      accessories={showDetail ? undefined : accessories}
      detail={detail}
      actions={
        <ActionPanel>
          {agent.live ? (
            <>
              <Action title="Jump to Ghostty" icon={Icon.Window} onAction={() => act(jumpToGhostty, "Raised Ghostty")} />
              <Action
                title="Resume in New Tab"
                icon={Icon.Terminal}
                onAction={() => act(() => resumeAgent(agent), `Resuming ${agent.repo}`)}
              />
              {agent.state === "working" && (
                <Action title="Stop Agent" icon={Icon.Stop} style={Action.Style.Destructive} onAction={doStop} />
              )}
            </>
          ) : (
            <>
              <Action
                title="Resume in New Tab"
                icon={Icon.Terminal}
                onAction={() => act(() => resumeAgent(agent), `Resuming ${agent.repo}`)}
              />
              <Action
                title="Fork Session"
                icon={Icon.Duplicate}
                onAction={() => act(() => forkAgent(agent), `Forking ${agent.repo}`)}
              />
            </>
          )}
          <Action
            title={showDetail ? "Hide Details" : "Show Details"}
            icon={Icon.Sidebar}
            shortcut={{ modifiers: ["cmd"], key: "i" }}
            onAction={toggleDetail}
          />
          <Action
            title="Undo Last Turn"
            icon={Icon.ArrowCounterClockwise}
            onAction={() => act(() => openUndo(agent.cwd), "Opened claude-undo")}
          />
          <Action title="Open Folder" icon={Icon.Folder} onAction={() => open(agent.cwd)} />
          <Action.CopyToClipboard title="Copy Session ID" content={agent.sessionId} />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={onRefresh}
          />
          <Action
            title="Clean Up Stale Fleet Files"
            icon={Icon.Trash}
            shortcut={{ modifiers: ["cmd", "shift"], key: "k" }}
            onAction={cleanUp}
          />
        </ActionPanel>
      }
    />
  );
}

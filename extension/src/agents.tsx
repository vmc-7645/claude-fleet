// Agents — the console. Active (Claude's live registry + fleet hook) + Recent
// (transcript history). Each row obeys `→ Claude`. SPEC §5.1.

import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Image,
  Form,
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
  open,
  confirmAlert,
  Alert,
  useNavigation,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { loadAgents } from "./lib/rank";
import { cleanupStaleFleet } from "./lib/fleet";
import { deleteTranscriptAt } from "./lib/history";
import { prefs } from "./lib/prefs";
import { Agent } from "./lib/types";
import { focusSupported } from "./lib/terminal";
import { preflight, Issue } from "./lib/preflight";
import {
  resumeAgent,
  forkAgent,
  focusOrRaise,
  openUndo,
  stopAgent,
  closeAgentTab,
  nudgeAgent,
  resumeCommand,
  openInEditor,
} from "./lib/claude";

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

function agentIcon(a: Agent): Image.ImageLike {
  if (!a.live) return { source: Icon.Clock, tintColor: Color.SecondaryText };
  switch (a.state) {
    case "working":
      return { source: Icon.Gear, tintColor: Color.Blue };
    case "waiting":
      return { source: Icon.Bell, tintColor: Color.Orange };
    case "done":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    default:
      return { source: Icon.Moon, tintColor: Color.SecondaryText };
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
  const [scope, setScope] = useState("all");
  const [issues, setIssues] = useState<Issue[]>([]);

  function refresh() {
    try {
      const r = loadAgents();
      setActive(r.active);
      setRecent(r.recent);
    } catch (e) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load agents",
        message: String(e),
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    preflight()
      .then(setIssues)
      .catch(() => setIssues([]));
  }, []);

  async function cleanUp() {
    const keep = new Set<string>(
      [...active, ...recent].map((a) => a.sessionId),
    );
    const n = cleanupStaleFleet(keep);
    await showToast({
      style: Toast.Style.Success,
      title: `Cleaned up ${n} stale fleet file(s)`,
    });
  }

  const repos = Array.from(
    new Set([...active, ...recent].map((a) => a.repo)),
  ).sort();
  const inScope = (a: Agent) =>
    scope === "all" ||
    (scope === "active" && a.live) ||
    (scope === "recent" && !a.live) ||
    (scope.startsWith("repo:") && a.repo === scope.slice(5));

  const shownActive = active.filter(
    (a) => a.live && (scope === "all" || scope === "active" || inScope(a)),
  );
  const shownRecent = recent.filter(
    (a) => !a.live && (scope === "all" || scope === "recent" || inScope(a)),
  );
  const empty =
    !isLoading && shownActive.length === 0 && shownRecent.length === 0;

  const shared = {
    onRefresh: refresh,
    showDetail,
    toggleDetail: () => setShowDetail((v) => !v),
    cleanUp,
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      searchBarPlaceholder="Search agents by repo or title…"
      searchBarAccessory={
        <List.Dropdown tooltip="Scope" value={scope} onChange={setScope}>
          <List.Dropdown.Item icon={Icon.List} title="All" value="all" />
          <List.Dropdown.Item icon={Icon.Bolt} title="Active" value="active" />
          <List.Dropdown.Item icon={Icon.Clock} title="Recent" value="recent" />
          <List.Dropdown.Section title="Repo">
            {repos.map((r) => (
              <List.Dropdown.Item
                key={r}
                icon={Icon.Folder}
                title={r}
                value={`repo:${r}`}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {empty && (
        <List.EmptyView
          icon={{ source: Icon.Terminal, tintColor: Color.SecondaryText }}
          title="No Claude agents"
          description="Start one and it'll appear here."
        />
      )}
      {issues.length > 0 && (
        <List.Section title="⚠️ Setup">
          {issues.map((iss) => (
            <List.Item
              key={iss.key}
              icon={{ source: Icon.Warning, tintColor: Color.Orange }}
              title={iss.title}
              subtitle={iss.detail}
              actions={
                <ActionPanel>
                  <Action
                    title="Open Extension Preferences"
                    icon={Icon.Gear}
                    onAction={openExtensionPreferences}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
      <List.Section title={`Active (${shownActive.length})`}>
        {shownActive.map((a) => (
          <AgentItem key={a.sessionId} agent={a} {...shared} />
        ))}
      </List.Section>
      <List.Section title={`Recent (${shownRecent.length})`}>
        {shownRecent.map((a) => (
          <AgentItem key={a.sessionId} agent={a} {...shared} />
        ))}
      </List.Section>
    </List>
  );
}

function NudgeForm({ agent }: { agent: Agent }) {
  async function onSubmit(values: Form.Values) {
    const text = String(values.text || "").trim();
    if (!text) return;
    await closeMainWindow();
    try {
      const ok = await nudgeAgent(agent, text);
      await showHUD(ok ? `Sent to ${agent.repo}` : "Tab not found");
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send to Agent"
            icon={Icon.Message}
            onSubmit={onSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title={`Nudge ${agent.repo}`}
        placeholder="follow-up to type into the agent's tab…"
      />
    </Form>
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
  const { push } = useNavigation();
  const mode = modeLabel(agent.mode);
  const p = prefs();
  const canTabs = focusSupported();

  const ageLabel = agent.live
    ? `${agent.state} · ${timeAgo(agent.updatedAt)}`
    : `${timeAgo(agent.updatedAt)}${agent.turns ? ` · ${agent.turns}t` : ""}`;

  // "Stuck": still marked working but no update in a while — likely hung, or on a
  // very long operation. Heuristic (updatedAt can lag a legitimately busy agent),
  // so it's a soft flag, and the threshold is tunable (default 20m).
  const stuckMin = Number(p.stuckMinutes) > 0 ? Number(p.stuckMinutes) : 20;
  const stuck =
    agent.state === "working" &&
    Date.now() - agent.updatedAt > stuckMin * 60_000;

  const accessories: List.Item.Accessory[] = [];
  if (stuck) {
    accessories.push({
      tag: {
        value: `⚠️ stalled ${timeAgo(agent.updatedAt)}`,
        color: Color.Red,
      },
      tooltip: `Working but no update in ${timeAgo(agent.updatedAt)} — may be hung`,
    });
  }
  if (mode) accessories.push({ tag: { value: mode, color: Color.Purple } });
  if (agent.state === "waiting" && agent.stateReason) {
    accessories.push({
      tag: { value: agent.stateReason, color: Color.Orange },
    });
  } else if (agent.state === "working" && agent.lastTool) {
    accessories.push({ text: agent.lastTool });
  } else if (agent.diff) {
    accessories.push({ text: agent.diff });
  }
  accessories.push({ text: ageLabel });

  async function act(fn: () => Promise<void>, hud: string) {
    await closeMainWindow();
    try {
      await fn();
      await showHUD(hud);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  // Canned follow-ups typed straight into the agent's tab. Empty string = just
  // press Return (accept a default / submit).
  const quickReplies = (
    p.quickReplies ?? "Continue, Run the tests, Looks good — commit"
  )
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  async function quickReply(text: string, label: string) {
    await closeMainWindow();
    try {
      const ok = await nudgeAgent(agent, text);
      await showHUD(ok ? `${label} → ${agent.repo}` : "Tab not found");
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
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
      await showToast({
        style: Toast.Style.Success,
        title: `Sent stop to ${agent.repo}`,
      });
      onRefresh();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Stop failed",
        message: String(e),
      });
    }
  }

  async function doClose() {
    const ok = await confirmAlert({
      title: `Close ${agent.repo} tab?`,
      message: "Closes the agent's Ghostty tab (ends the session).",
      primaryAction: {
        title: "Close Tab",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!ok) return;
    await closeMainWindow();
    try {
      const found = await closeAgentTab(agent);
      await showHUD(found ? `Closed ${agent.repo}` : "Tab not found");
      onRefresh();
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  const markdown = agent.question
    ? `**Last message**\n\n${agent.question}`
    : "_No message captured yet._";
  const detail = (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Repo" text={agent.repo} />
          <List.Item.Detail.Metadata.Label title="State" text={agent.state} />
          {mode && <List.Item.Detail.Metadata.Label title="Mode" text={mode} />}
          {agent.title && (
            <List.Item.Detail.Metadata.Label title="Task" text={agent.title} />
          )}
          {agent.stateReason && (
            <List.Item.Detail.Metadata.Label
              title="Waiting on"
              text={agent.stateReason}
            />
          )}
          {agent.lastTool && (
            <List.Item.Detail.Metadata.Label
              title="Last tool"
              text={agent.lastTool}
            />
          )}
          {agent.diff && (
            <List.Item.Detail.Metadata.Label title="Diff" text={agent.diff} />
          )}
          {agent.turns ? (
            <List.Item.Detail.Metadata.Label
              title="Turns"
              text={String(agent.turns)}
            />
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Path" text={agent.cwd} />
          <List.Item.Detail.Metadata.Label
            title="Session"
            text={agent.sessionId}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );

  const focusAction = (
    <Action
      title="Focus Tab"
      icon={Icon.Window}
      onAction={async () => {
        await closeMainWindow();
        // Honest HUD: focusOrRaise returns false when no exact tab matched and it
        // only raised the terminal, so don't claim we focused the agent's tab.
        const ok = await focusOrRaise(agent).catch(() => false);
        await showHUD(
          ok
            ? `Focusing ${agent.repo}`
            : `Raised terminal — no exact tab for ${agent.repo}`,
        );
      }}
    />
  );
  const resumeAction = (
    <Action
      title="Resume in New Tab"
      icon={Icon.Terminal}
      onAction={() => act(() => resumeAgent(agent), `Resuming ${agent.repo}`)}
    />
  );
  // Fork = a new session that starts from a copy of this one's history and
  // diverges (claude --resume … --fork-session). Works on a live agent too — it
  // reads the transcript, so the original keeps running untouched.
  const forkAction = (
    <Action
      title="Fork Session"
      icon={Icon.Duplicate}
      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
      onAction={() => act(() => forkAgent(agent), `Forking ${agent.repo}`)}
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
              {/* Focus/Nudge/Close drive an exact tab — Ghostty only. Other
                  terminals fall back to Resume as the primary action. */}
              {canTabs ? (
                <>
                  {p.primaryClick === "resume" ? resumeAction : focusAction}
                  {p.primaryClick === "resume" ? focusAction : resumeAction}
                  <ActionPanel.Submenu
                    title="Quick Reply"
                    icon={Icon.Reply}
                    shortcut={{ modifiers: ["cmd"], key: "y" }}
                  >
                    {quickReplies.map((r) => (
                      <Action
                        key={r}
                        title={r}
                        icon={Icon.Text}
                        onAction={() => quickReply(r, r)}
                      />
                    ))}
                    <Action
                      title="Press Enter ↵ (Accept Default)"
                      icon={Icon.ArrowRight}
                      onAction={() => quickReply("", "↵")}
                    />
                  </ActionPanel.Submenu>
                  <Action
                    title="Nudge / Send Prompt"
                    icon={Icon.Message}
                    shortcut={{ modifiers: ["cmd"], key: "n" }}
                    onAction={() => push(<NudgeForm agent={agent} />)}
                  />
                </>
              ) : (
                resumeAction
              )}
              {forkAction}
              {agent.state === "working" && (
                <Action
                  title="Stop Agent"
                  icon={Icon.Stop}
                  style={Action.Style.Destructive}
                  onAction={doStop}
                />
              )}
              {canTabs && (
                <Action
                  title="Close Tab"
                  icon={Icon.XMarkCircle}
                  style={Action.Style.Destructive}
                  onAction={doClose}
                />
              )}
            </>
          ) : (
            <>
              {resumeAction}
              {forkAction}
              <Action
                title="Delete Session"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={async () => {
                  const ok = await confirmAlert({
                    title: `Delete ${agent.repo} session?`,
                    message: "Removes the transcript file (can't be undone).",
                    primaryAction: {
                      title: "Delete",
                      style: Alert.ActionStyle.Destructive,
                    },
                  });
                  if (!ok) return;
                  if (!deleteTranscriptAt(agent.transcriptPath || "")) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Couldn't delete session",
                      message: "Its transcript is already gone or unreadable.",
                    });
                  }
                  onRefresh();
                }}
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
            onAction={() =>
              act(() => openUndo(agent.cwd), "Opened claude-undo")
            }
          />
          <Action.CopyToClipboard
            title="Copy Resume Command"
            content={resumeCommand(agent)}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action
            title="Open in Editor"
            icon={Icon.Code}
            onAction={() =>
              act(
                () => openInEditor(agent.cwd, p.editorCommand || "code"),
                "Opening editor",
              )
            }
          />
          <Action
            title="Open Folder"
            icon={Icon.Folder}
            onAction={() => open(agent.cwd)}
          />
          <Action.CopyToClipboard
            title="Copy Session ID"
            content={agent.sessionId}
          />
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

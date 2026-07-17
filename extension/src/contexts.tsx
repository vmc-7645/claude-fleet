// Contexts — search every Claude session by what was said in it, scoped by the
// branch or repo it happened on. Each row obeys `→ Claude`. SPEC §5.9.

import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Image,
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
  open,
  confirmAlert,
  Alert,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import {
  ContextRecord,
  buildIndex,
  clearIndex,
  deleteContext,
  isOrphaned,
  shortPath,
} from "./lib/contexts";
import { searchContexts } from "./lib/context-query";
import { readActiveSessions } from "./lib/sessions";
import { readFleetEntry } from "./lib/fleet";
import { Worktree, listWorktrees } from "./lib/worktrees";
import { prefs } from "./lib/prefs";
import { Agent, AgentState, liveState } from "./lib/types";
import {
  resumeAgent,
  forkAgent,
  focusOrRaise,
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

// What the index knows, plus the live state merged on at load. Worktree facts
// are NOT folded in here — they're joined at render (see `wts`), so a refresh
// that rebuilds rows can't drop them.
interface Row extends ContextRecord {
  orphaned: boolean;
  state?: AgentState; // narrowed by liveState(); never a raw hook string
}

function rowIcon(r: Row): Image.ImageLike {
  if (r.live) return { source: Icon.Bolt, tintColor: Color.Blue };
  if (r.orphaned) return { source: Icon.Warning, tintColor: Color.Orange };
  return { source: Icon.Clock, tintColor: Color.SecondaryText };
}

// Resume/Fork/Focus speak Agent, not ContextRecord.
function toAgent(r: Row): Agent {
  return {
    sessionId: r.sessionId,
    cwd: r.root,
    repo: r.repo,
    title: r.title,
    live: Boolean(r.live),
    state: r.state || "idle",
    updatedAt: r.updatedAt,
    turns: r.turns,
  };
}

export default function Command() {
  const [rows, setRows] = useState<Row[]>([]);
  const [wts, setWts] = useState<Map<string, Worktree>>(new Map());
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);

  function refresh() {
    try {
      // Live state comes from Claude's own registry, never from the index —
      // the index is history, and history is never live.
      const live = new Map(readActiveSessions().map((s) => [s.sessionId, s]));
      setRows(
        buildIndex().map((rec) => {
          const s = live.get(rec.sessionId);
          const fleet = s ? readFleetEntry(rec.sessionId) : undefined;
          return {
            ...rec,
            live: Boolean(s),
            state: s ? liveState(s.status === "busy", fleet?.state) : undefined,
            orphaned: isOrphaned(rec),
          };
        }),
      );
    } catch (e) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to build context index",
        message: String(e),
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(refresh, []);

  // Second phase, like My PRs: the list is usable off the index alone; git only
  // decides the 🍂 merged tag, and shells out per repo, so it lands late. It's
  // kept in its own state and joined by path at render — folding it into `rows`
  // would mean any later refresh() (⌘R, Rebuild Index) silently dropped it.
  useEffect(() => {
    listWorktrees(prefs().reposRoot)
      .then((list) => setWts(new Map(list.map((w) => [w.path, w]))))
      .catch(() => {
        // No repos configured / git unavailable — the index alone still works.
      });
  }, []);

  async function rebuild() {
    clearIndex();
    setIsLoading(true);
    refresh();
    await showToast({ style: Toast.Style.Success, title: "Rebuilt index" });
  }

  // The dropdown injects a token into the same query the search bar feeds, so
  // there's one filter path, not two — and typing `branch:x` does exactly what
  // picking it from the dropdown does.
  const matches = useMemo(
    () => searchContexts(scope === "all" ? text : `${scope} ${text}`, rows),
    [text, scope, rows],
  );

  // Branch counts label the dropdown, so you can see where your work actually
  // lives before you pick.
  const branches = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) {
      for (const b of r.branches) n.set(b, (n.get(b) || 0) + 1);
    }
    return [...n.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [rows]);

  const repos = useMemo(
    () => [...new Set(rows.map((r) => r.repo))].sort(),
    [rows],
  );

  const shared = {
    onRefresh: refresh,
    onRebuild: rebuild,
    showDetail,
    toggleDetail: () => setShowDetail((v) => !v),
  };

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail}
      // Rows are matched against transcript BODIES, not just their titles, so
      // Raycast's built-in filtering (title/subtitle only) can't do this — the
      // one place in the extension that owns its own search. It's an in-memory
      // scan over a prebuilt index (~5ms across 238 sessions), so it stays
      // synchronous and unthrottled; throttling would only add lag.
      filtering={false}
      onSearchTextChange={setText}
      searchBarPlaceholder="Search what was said — or branch:… repo:… is:live"
      searchBarAccessory={
        <List.Dropdown tooltip="Scope" value={scope} onChange={setScope}>
          <List.Dropdown.Item icon={Icon.List} title="All" value="all" />
          <List.Dropdown.Section title="Branch">
            {branches.map(([b, n]) => (
              <List.Dropdown.Item
                key={b}
                icon={Icon.Tree}
                title={`${b} (${n})`}
                value={`branch:"${b}"`}
              />
            ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Repo">
            {repos.map((r) => (
              <List.Dropdown.Item
                key={r}
                icon={Icon.Folder}
                title={r}
                value={`repo:"${r}"`}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {!isLoading && matches.length === 0 && (
        <List.EmptyView
          icon={{
            source: Icon.MagnifyingGlass,
            tintColor: Color.SecondaryText,
          }}
          title={
            text || scope !== "all" ? "No matching contexts" : "No contexts yet"
          }
          description={
            text || scope !== "all"
              ? "Try a different term, or widen the scope to All."
              : "Sessions appear here once you've run Claude in a repo."
          }
        />
      )}
      <List.Section title={`Contexts (${matches.length})`}>
        {matches.map((m) => (
          <ContextItem
            key={m.rec.path}
            row={m.rec as Row}
            wt={wts.get(m.rec.root)}
            snippet={m.snippet}
            {...shared}
          />
        ))}
      </List.Section>
    </List>
  );
}

function ContextItem(props: {
  row: Row;
  wt?: Worktree; // joined by path at render, not folded into the row
  snippet: string;
  onRefresh: () => void;
  onRebuild: () => Promise<void>;
  showDetail: boolean;
  toggleDetail: () => void;
}) {
  const { row, wt, snippet, onRefresh, onRebuild, showDetail, toggleDetail } =
    props;
  const p = prefs();
  const agent = toAgent(row);

  const accessories: List.Item.Accessory[] = [];
  if (row.branch) {
    accessories.push({
      tag: {
        value: row.branch,
        color: wt?.merged
          ? Color.Yellow
          : row.branch === "main" || row.branch === "master"
            ? Color.Green
            : Color.Blue,
      },
    });
  }
  if (row.branches.length > 1) {
    accessories.push({
      tag: { value: `+${row.branches.length - 1}`, color: Color.SecondaryText },
    });
  }
  if (row.orphaned) {
    accessories.push({ tag: { value: "gone", color: Color.Orange } });
  }
  accessories.push({
    text: `${timeAgo(row.updatedAt)}${row.turns ? ` · ${row.turns}t` : ""}`,
  });

  async function act(fn: () => Promise<void>, hud: string) {
    await closeMainWindow();
    try {
      await fn();
      await showHUD(hud);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  const markdown = snippet
    ? `**Match**\n\n${snippet}`
    : row.messages.length
      ? `**Last message**\n\n${row.messages[row.messages.length - 1].text.slice(0, 1200)}`
      : "_No message captured._";

  const detail = (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Repo" text={row.repo} />
          {/* Every branch the session touched — the one it ended on is tagged. */}
          <List.Item.Detail.Metadata.TagList title="Branches">
            {row.branches.map((b) => (
              <List.Item.Detail.Metadata.TagList.Item
                key={b}
                text={b}
                color={b === row.branch ? Color.Blue : Color.SecondaryText}
              />
            ))}
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.Label
            title="Worktree"
            // Orphaned first — it's known from the index alone. The rest needs
            // git, so "—" means "not known yet / not under your repos root",
            // never "not a worktree".
            text={
              row.orphaned
                ? "⚠️ directory is gone"
                : wt?.isMain
                  ? "main checkout"
                  : wt?.merged
                    ? "🍂 merged — safe to remove"
                    : wt
                      ? "worktree"
                      : "—"
            }
          />
          {row.live && (
            <List.Item.Detail.Metadata.Label
              title="State"
              text={row.state || "idle"}
            />
          )}
          {row.model && (
            <List.Item.Detail.Metadata.Label title="Model" text={row.model} />
          )}
          {row.turns ? (
            <List.Item.Detail.Metadata.Label
              title="Turns"
              text={String(row.turns)}
            />
          ) : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Path"
            text={shortPath(row.root)}
          />
          <List.Item.Detail.Metadata.Label
            title="Session"
            text={row.sessionId}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );

  return (
    <List.Item
      icon={rowIcon(row)}
      title={row.title || row.repo}
      subtitle={showDetail ? undefined : row.repo}
      accessories={showDetail ? undefined : accessories}
      detail={detail}
      actions={
        <ActionPanel>
          {row.live ? (
            <Action
              title="Focus Tab"
              icon={Icon.Window}
              onAction={() =>
                act(() => focusOrRaise(agent), `Focusing ${row.repo}`)
              }
            />
          ) : null}
          {/* Resuming into a directory that no longer exists just fails in the
              tab, so it's offered but not primary for an orphaned context. */}
          <Action
            title="Resume in New Tab"
            icon={Icon.Terminal}
            onAction={() =>
              act(() => resumeAgent(agent), `Resuming ${row.repo}`)
            }
          />
          <Action
            title="Fork Session"
            icon={Icon.Duplicate}
            onAction={() => act(() => forkAgent(agent), `Forking ${row.repo}`)}
          />
          <Action
            title={showDetail ? "Hide Details" : "Show Details"}
            icon={Icon.Sidebar}
            shortcut={{ modifiers: ["cmd"], key: "i" }}
            onAction={toggleDetail}
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
                () => openInEditor(row.root, p.editorCommand || "code"),
                "Opening editor",
              )
            }
          />
          <Action
            title="Open Folder"
            icon={Icon.Folder}
            onAction={() => open(row.root)}
          />
          <Action.CopyToClipboard
            title="Copy Session ID"
            content={row.sessionId}
          />
          <Action
            title="Delete Session"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={async () => {
              const ok = await confirmAlert({
                title: `Delete ${row.repo} session?`,
                message: "Removes the transcript file (can't be undone).",
                primaryAction: {
                  title: "Delete",
                  style: Alert.ActionStyle.Destructive,
                },
              });
              if (!ok) return;
              deleteContext(row);
              onRefresh();
            }}
          />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={onRefresh}
          />
          <Action
            title="Rebuild Index"
            icon={Icon.ArrowCounterClockwise}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={onRebuild}
          />
        </ActionPanel>
      }
    />
  );
}

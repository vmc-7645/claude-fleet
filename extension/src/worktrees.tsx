// Worktrees — list git worktrees across your repos; open / resume / remove.
// Merged-into-default branches are flagged as safe to remove. SPEC §5.8.

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
import { basename } from "path";
import { listWorktrees, removeWorktree, Worktree } from "./lib/worktrees";
import { continueInDir, openInEditor } from "./lib/claude";
import { prefs } from "./lib/prefs";

export default function Command() {
  const [wts, setWts] = useState<Worktree[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    try {
      setWts(await listWorktrees(prefs().reposRoot));
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load worktrees",
        message: String(e),
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const repos = Array.from(new Set(wts.map((w) => w.repo)));

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search worktrees…">
      {!isLoading && wts.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.Tree, tintColor: Color.Green }}
          title="No worktrees"
          description="Spawn an agent or Check Out & Work a PR to create one."
        />
      )}
      {repos.map((repo) => (
        <List.Section key={repo} title={repo}>
          {wts
            .filter((w) => w.repo === repo)
            .map((w) => (
              <WtItem key={w.path} wt={w} onChange={load} />
            ))}
        </List.Section>
      ))}
    </List>
  );
}

function WtItem({ wt, onChange }: { wt: Worktree; onChange: () => void }) {
  async function run(fn: () => Promise<void>, hud: string) {
    await closeMainWindow();
    try {
      await fn();
      await showHUD(hud);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  async function remove() {
    const ok = await confirmAlert({
      title: `Remove worktree ${basename(wt.path)}?`,
      message: `${wt.path}\n\nThis deletes the worktree directory (branch is kept).`,
      primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    try {
      await removeWorktree(wt);
      await showToast({
        style: Toast.Style.Success,
        title: `Removed ${basename(wt.path)}`,
      });
      onChange();
    } catch (e) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Remove failed",
        message: String(e),
      });
    }
  }

  const accessories: List.Item.Accessory[] = [];
  if (wt.isMain)
    accessories.push({ tag: { value: "main", color: Color.SecondaryText } });
  if (wt.merged)
    accessories.push({ tag: { value: "merged", color: Color.Green } });
  accessories.push({ text: wt.path.replace(process.env.HOME || "", "~") });

  return (
    <List.Item
      icon={
        wt.isMain
          ? { source: Icon.Tree, tintColor: Color.Green }
          : wt.merged
            ? { source: Icon.Leaf, tintColor: Color.Yellow }
            : { source: Icon.Code, tintColor: Color.Green }
      }
      title={wt.branch || basename(wt.path)}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action
            title="Open in Claude"
            icon={Icon.Terminal}
            onAction={() =>
              run(
                () => continueInDir(wt.path),
                `Opening ${wt.branch || basename(wt.path)}`,
              )
            }
          />
          <Action
            title="Open in Editor"
            icon={Icon.Code}
            onAction={() =>
              run(
                () => openInEditor(wt.path, prefs().editorCommand || "code"),
                "Opening editor",
              )
            }
          />
          <Action
            title="Open Folder"
            icon={Icon.Folder}
            onAction={() => open(wt.path)}
          />
          {!wt.isMain && (
            <Action
              title="Remove Worktree"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={remove}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

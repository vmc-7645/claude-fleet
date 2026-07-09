// Worktrees — list git worktrees across your repos; open / resume / remove.
// SPEC §5.8.

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
import { continueInDir } from "./lib/claude";

export default function Command() {
  const [wts, setWts] = useState<Worktree[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    try {
      setWts(await listWorktrees());
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to load worktrees", message: String(e) });
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
  async function openClaude() {
    try {
      await continueInDir(wt.path);
      await showHUD(`Opening ${wt.branch || basename(wt.path)}`);
      await closeMainWindow();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed", message: String(e) });
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
      await showToast({ style: Toast.Style.Success, title: `Removed ${basename(wt.path)}` });
      onChange();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Remove failed", message: String(e) });
    }
  }

  const accessories: List.Item.Accessory[] = [{ text: wt.path.replace(process.env.HOME || "", "~") }];
  if (wt.isMain) accessories.unshift({ tag: { value: "main", color: Color.SecondaryText } });

  return (
    <List.Item
      icon={wt.isMain ? "🌳" : "🌿"}
      title={wt.branch || basename(wt.path)}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action title="Open in Claude" icon={Icon.Terminal} onAction={openClaude} />
          <Action title="Open Folder" icon={Icon.Folder} onAction={() => open(wt.path)} />
          {!wt.isMain && (
            <Action title="Remove Worktree" icon={Icon.Trash} style={Action.Style.Destructive} onAction={remove} />
          )}
        </ActionPanel>
      }
    />
  );
}

// My PRs — cross-repo list of your open PRs; each row → Review in Claude.
// SPEC §5.2.

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
} from "@raycast/api";
import { useEffect, useState } from "react";
import { searchMyPRs, PR } from "./lib/gh";
import { reviewPR, checkoutAndWork, resumeFromPr } from "./lib/claude";
import { repoPath } from "./lib/repos";

export default function Command() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setPrs(await searchMyPRs());
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "Failed to load PRs", message: String(e) });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search your open PRs…">
      {!isLoading && prs.length === 0 && <List.EmptyView icon="🔀" title="No open PRs" />}
      {prs.map((pr) => (
        <PRItem key={pr.url} pr={pr} />
      ))}
    </List>
  );
}

function PRItem({ pr }: { pr: PR }) {
  const local = repoPath(pr.repo);

  async function withLocal(fn: (path: string) => Promise<void>, hud: string) {
    if (!local) {
      await showToast({ style: Toast.Style.Failure, title: "Repo not cloned locally", message: pr.repo });
      return;
    }
    // Close Raycast first so keystrokes reach Ghostty, not Raycast's panel.
    await closeMainWindow();
    try {
      await fn(local);
      await showHUD(hud);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  const accessories: List.Item.Accessory[] = [{ text: pr.repo }];
  if (pr.isDraft) accessories.unshift({ tag: { value: "draft", color: Color.SecondaryText } });

  return (
    <List.Item
      icon={pr.isDraft ? "📝" : "🔀"}
      title={`#${pr.number}`}
      subtitle={pr.title}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action
            title="Review in Claude"
            icon={Icon.MagnifyingGlass}
            onAction={() => withLocal((p) => reviewPR(p, pr.number), `Reviewing ${pr.repo}#${pr.number}`)}
          />
          <Action
            title="Check Out & Work"
            icon={Icon.Hammer}
            onAction={() =>
              withLocal((p) => checkoutAndWork(p, pr.repo, pr.number, pr.title), `Checking out ${pr.repo}#${pr.number}`)
            }
          />
          <Action
            title="Resume PR Agent"
            icon={Icon.Terminal}
            onAction={() => withLocal((p) => resumeFromPr(p, pr.number), `Resuming ${pr.repo}#${pr.number}`)}
          />
          <Action.OpenInBrowser url={pr.url} />
          <Action.CopyToClipboard title="Copy PR URL" content={pr.url} />
        </ActionPanel>
      }
    />
  );
}

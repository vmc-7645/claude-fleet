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
import { reviewPR } from "./lib/claude";
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

  async function doReview() {
    if (!local) {
      await showToast({ style: Toast.Style.Failure, title: "Repo not cloned locally", message: pr.repo });
      return;
    }
    try {
      await reviewPR(local, pr.number);
      await showHUD(`Reviewing ${pr.repo}#${pr.number}`);
      await closeMainWindow();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed", message: String(e) });
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
          <Action title="Review in Claude" icon={Icon.MagnifyingGlass} onAction={doReview} />
          <Action.OpenInBrowser url={pr.url} />
          <Action.CopyToClipboard title="Copy PR URL" content={pr.url} />
        </ActionPanel>
      }
    />
  );
}

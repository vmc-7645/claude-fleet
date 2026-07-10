// My Issues — cross-repo list of issues you opened; start an agent on one.
// SPEC §5.7.

import { List, ActionPanel, Action, Icon, showToast, Toast, showHUD, closeMainWindow } from "@raycast/api";
import { useEffect, useState } from "react";
import { searchMyIssues, Issue } from "./lib/gh";
import { spawnAgent } from "./lib/claude";
import { repoPath } from "./lib/repos";

export default function Command() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setIssues(await searchMyIssues());
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "Failed to load issues", message: String(e) });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search your open issues…">
      {!isLoading && issues.length === 0 && <List.EmptyView icon="🐛" title="No open issues" />}
      {issues.map((i) => (
        <IssueItem key={i.url} issue={i} />
      ))}
    </List>
  );
}

function IssueItem({ issue }: { issue: Issue }) {
  const local = repoPath(issue.repo);

  async function startAgent() {
    if (!local) {
      await showToast({ style: Toast.Style.Failure, title: "Repo not cloned locally", message: issue.repo });
      return;
    }
    await closeMainWindow();
    try {
      await spawnAgent(local, `issue/${issue.number}`, `Work on issue #${issue.number}: ${issue.title}`);
      await showHUD(`Started agent for ${issue.repo}#${issue.number}`);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  return (
    <List.Item
      icon="🐛"
      title={`#${issue.number}`}
      subtitle={issue.title}
      accessories={[{ text: issue.repo }]}
      actions={
        <ActionPanel>
          <Action title="Start Agent on This Issue" icon={Icon.Rocket} onAction={startAgent} />
          <Action.OpenInBrowser url={issue.url} />
          <Action.CopyToClipboard title="Copy Issue URL" content={issue.url} />
        </ActionPanel>
      }
    />
  );
}

// My Issues — cross-repo list of issues you opened; start an agent on one.
// Search matches the repo name (and #number) as well as the title, and a repo
// Scope dropdown narrows to one repo. SPEC §5.7.

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
import { useEffect, useMemo, useState } from "react";
import { searchMyIssues, Issue } from "./lib/gh";
import { spawnAgent } from "./lib/claude";
import { repoPath } from "./lib/repos";
import { prefs } from "./lib/prefs";

// The repo's short name — what you'd type to find it (`owner/foo` → `foo`).
function shortRepo(repo: string): string {
  return repo.split("/").pop() || repo;
}

export default function Command() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState("all");

  useEffect(() => {
    (async () => {
      try {
        setIssues(await searchMyIssues());
      } catch (e) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load issues",
          message: String(e),
        });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Repos present, with a count each, most-issues first — labels the dropdown so
  // you can see where your issues actually are before scoping.
  const repos = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of issues) n.set(i.repo, (n.get(i.repo) || 0) + 1);
    return [...n.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [issues]);

  const shown =
    scope === "all" ? issues : issues.filter((i) => i.repo === scope);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search by repo, #number, or title…"
      searchBarAccessory={
        <List.Dropdown tooltip="Repo" value={scope} onChange={setScope}>
          <List.Dropdown.Item icon={Icon.List} title="All Repos" value="all" />
          <List.Dropdown.Section title="Repo">
            {repos.map(([repo, count]) => (
              <List.Dropdown.Item
                key={repo}
                icon={Icon.Folder}
                title={`${repo} (${count})`}
                value={repo}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {!isLoading && shown.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.Bug, tintColor: Color.Green }}
          title={scope === "all" ? "No open issues" : "No issues in this repo"}
          description="Issues you've opened across your repos show up here."
        />
      )}
      {shown.map((i) => (
        <IssueItem key={i.url} issue={i} />
      ))}
    </List>
  );
}

function IssueItem({ issue }: { issue: Issue }) {
  const local = repoPath(issue.repo, prefs().reposRoot);

  async function startAgent() {
    if (!local) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Repo not cloned locally",
        message: issue.repo,
      });
      return;
    }
    await closeMainWindow();
    try {
      await spawnAgent(
        local,
        `issue/${issue.number}`,
        `Work on issue #${issue.number}: ${issue.title}`,
      );
      await showHUD(`Started agent for ${issue.repo}#${issue.number}`);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  return (
    <List.Item
      icon={{ source: Icon.Bug, tintColor: Color.Green }}
      title={`#${issue.number}`}
      subtitle={issue.title}
      // Built-in search only sees title/subtitle/keywords — the repo lives in an
      // accessory, so add it (full owner/repo AND short name) plus the number
      // here to make typing a repo name scope the list.
      keywords={[issue.repo, shortRepo(issue.repo), `#${issue.number}`]}
      accessories={[{ text: issue.repo }]}
      actions={
        <ActionPanel>
          <Action
            title="Start Agent on This Issue"
            icon={Icon.Rocket}
            onAction={startAgent}
          />
          <Action.OpenInBrowser url={issue.url} />
          <Action.CopyToClipboard title="Copy Issue URL" content={issue.url} />
        </ActionPanel>
      }
    />
  );
}

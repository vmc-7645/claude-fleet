// My PRs — cross-repo list of your open PRs with CI status; each row → Review in
// Claude / Check out & work / Resume PR agent. Cached list, batched CI, and a
// repo Scope dropdown / repo-name search come from ./lib/pr-ui. SPEC §5.2.

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
import { useState } from "react";
import { searchMyPRs, PR, CiStatus } from "./lib/gh";
import { reviewPR, checkoutAndWork, resumeFromPr } from "./lib/claude";
import { repoPath } from "./lib/repos";
import { prefs } from "./lib/prefs";
import {
  usePRList,
  RepoScopeDropdown,
  ciAccessory,
  prKeywords,
  ciKey,
} from "./lib/pr-ui";

export default function Command() {
  const [scope, setScope] = useState("all");
  const { prs, ci, isLoading, revalidate, repos } = usePRList(
    searchMyPRs,
    "Failed to load PRs",
  );
  const shown = scope === "all" ? prs : prs.filter((p) => p.repo === scope);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search by repo, #number, or title…"
      searchBarAccessory={
        <RepoScopeDropdown scope={scope} onChange={setScope} repos={repos} />
      }
    >
      {!isLoading && shown.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.CodeBlock, tintColor: Color.Blue }}
          title={scope === "all" ? "No open PRs" : "No PRs in this repo"}
          description="Your open pull requests across repos show up here."
        />
      )}
      {shown.map((pr) => (
        <PRItem
          key={pr.url}
          pr={pr}
          ci={ci.get(ciKey(pr.repo, pr.number))}
          onRefresh={revalidate}
        />
      ))}
    </List>
  );
}

function PRItem({
  pr,
  ci,
  onRefresh,
}: {
  pr: PR;
  ci?: CiStatus;
  onRefresh: () => void;
}) {
  const local = repoPath(pr.repo, prefs().reposRoot);

  async function withLocal(fn: (path: string) => Promise<void>, hud: string) {
    if (!local) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Repo not cloned locally",
        message: pr.repo,
      });
      return;
    }
    await closeMainWindow();
    try {
      await fn(local);
      await showHUD(hud);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  const accessories: List.Item.Accessory[] = [];
  const c = ciAccessory(ci);
  if (c) accessories.push(c);
  if (pr.isDraft)
    accessories.push({ tag: { value: "draft", color: Color.SecondaryText } });
  accessories.push({ text: pr.repo });

  return (
    <List.Item
      icon={
        pr.isDraft
          ? { source: Icon.Pencil, tintColor: Color.SecondaryText }
          : { source: Icon.CodeBlock, tintColor: Color.Blue }
      }
      title={`#${pr.number}`}
      subtitle={pr.title}
      keywords={prKeywords(pr)}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action
            title="Review in Claude"
            icon={Icon.MagnifyingGlass}
            onAction={() =>
              withLocal(
                (p) => reviewPR(p, pr.number),
                `Reviewing ${pr.repo}#${pr.number}`,
              )
            }
          />
          <Action
            title="Check Out & Work"
            icon={Icon.Hammer}
            onAction={() =>
              withLocal(
                (p) => checkoutAndWork(p, pr.repo, pr.number, pr.title),
                `Checking out ${pr.repo}#${pr.number}`,
              )
            }
          />
          <Action
            title="Resume PR Agent"
            icon={Icon.Terminal}
            onAction={() =>
              withLocal(
                (p) => resumeFromPr(p, pr.number),
                `Resuming ${pr.repo}#${pr.number}`,
              )
            }
          />
          <Action.OpenInBrowser url={pr.url} />
          <Action.CopyToClipboard title="Copy PR URL" content={pr.url} />
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

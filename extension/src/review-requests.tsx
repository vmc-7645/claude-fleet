// PRs to Review — cross-repo list of PRs where someone requested YOUR review.
// Primary action hands the PR to `claude /review`, cloning the repo on demand
// if you don't have it locally. Cached list, batched CI, and a repo Scope
// dropdown / repo-name search come from ./lib/pr-ui. SPEC §5.2 (review side).

import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  showHUD,
  closeMainWindow,
} from "@raycast/api";
import { useState } from "react";
import { searchReviewRequests, PR, CiStatus } from "./lib/gh";
import { reviewPR } from "./lib/claude";
import { resolveRepoPath } from "./lib/repos";
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
    searchReviewRequests,
    "Failed to load review requests",
  );
  const shown = scope === "all" ? prs : prs.filter((p) => p.repo === scope);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search by repo, author, #number, or title…"
      searchBarAccessory={
        <RepoScopeDropdown scope={scope} onChange={setScope} repos={repos} />
      }
    >
      {!isLoading && shown.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.Eye, tintColor: Color.Red }}
          title={scope === "all" ? "No PRs to review" : "No PRs in this repo"}
          description="Nothing is waiting on your review right now."
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
  const root = prefs().reposRoot;

  async function review() {
    await closeMainWindow();
    try {
      // Resolve to a local path, cloning the "owner/name" on demand.
      await showHUD(`Preparing ${pr.repo}…`);
      const path = await resolveRepoPath(pr.repo, root);
      if (!path) throw new Error("could not resolve repo");
      await reviewPR(path, pr.number);
      await showHUD(`Reviewing ${pr.repo}#${pr.number}`);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
    }
  }

  const accessories: List.Item.Accessory[] = [];
  const c = ciAccessory(ci);
  if (c) accessories.push(c);
  if (pr.isDraft)
    accessories.push({ tag: { value: "draft", color: Color.SecondaryText } });
  if (pr.author)
    accessories.push({ tag: { value: `@${pr.author}`, color: Color.Blue } });
  accessories.push({ text: pr.repo });

  return (
    <List.Item
      icon={
        pr.isDraft
          ? { source: Icon.Pencil, tintColor: Color.SecondaryText }
          : { source: Icon.Eye, tintColor: Color.Red }
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
            onAction={review}
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

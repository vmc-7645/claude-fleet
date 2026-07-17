// PRs to Review — cross-repo list of PRs where someone requested YOUR review.
// Primary action hands the PR to `claude /review`, cloning the repo on demand
// if you don't have it locally. Cached list, one batched CI call, and a repo
// Scope dropdown / repo-name search. SPEC §5.2 (review side).

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
import { useCachedPromise } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import {
  searchReviewRequests,
  prCiStatuses,
  ciKey,
  PR,
  CiStatus,
} from "./lib/gh";
import { reviewPR } from "./lib/claude";
import { resolveRepoPath } from "./lib/repos";
import { prefs } from "./lib/prefs";

function shortRepo(repo: string): string {
  return repo.split("/").pop() || repo;
}

export default function Command() {
  const [scope, setScope] = useState("all");

  const {
    data: prs = [],
    isLoading,
    revalidate,
  } = useCachedPromise(searchReviewRequests, [], {
    initialData: [] as PR[],
    keepPreviousData: true,
    onError: (e) => {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load review requests",
        message: String(e),
      });
    },
  });

  const [ci, setCi] = useState<Map<string, CiStatus>>(new Map());
  useEffect(() => {
    if (prs.length === 0) return;
    let cancelled = false;
    prCiStatuses(prs)
      .then((m) => {
        if (!cancelled) setCi(m);
      })
      .catch(() => {
        /* CI is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [prs]);

  const repos = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of prs) n.set(p.repo, (n.get(p.repo) || 0) + 1);
    return [...n.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [prs]);

  const shown = scope === "all" ? prs : prs.filter((p) => p.repo === scope);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search by repo, author, #number, or title…"
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

function ciAccessory(ci?: CiStatus): List.Item.Accessory | undefined {
  switch (ci) {
    case "pass":
      return {
        icon: { source: Icon.CheckCircle, tintColor: Color.Green },
        tooltip: "checks passing",
      };
    case "fail":
      return {
        icon: { source: Icon.XMarkCircle, tintColor: Color.Red },
        tooltip: "checks failing",
      };
    case "pending":
      return {
        icon: { source: Icon.Clock, tintColor: Color.Yellow },
        tooltip: "checks running",
      };
    case "unknown":
      return {
        icon: {
          source: Icon.QuestionMarkCircle,
          tintColor: Color.SecondaryText,
        },
        tooltip: "checks status unavailable",
      };
    default:
      return undefined;
  }
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
      // Built-in search sees title/subtitle/keywords only — add repo (owner/repo
      // + short name), the number, and the author so all are searchable.
      keywords={[
        pr.repo,
        shortRepo(pr.repo),
        `#${pr.number}`,
        ...(pr.author ? [pr.author] : []),
      ]}
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

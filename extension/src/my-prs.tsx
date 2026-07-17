// My PRs — cross-repo list of your open PRs with CI status; each row → Review in
// Claude / Check out & work / Resume PR agent. The list is cached (instant open,
// background revalidate), CI is fetched for every PR in one batched call, and a
// repo Scope dropdown / repo-name search narrow it. SPEC §5.2.

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
import { searchMyPRs, prCiStatuses, ciKey, PR, CiStatus } from "./lib/gh";
import { reviewPR, checkoutAndWork, resumeFromPr } from "./lib/claude";
import { repoPath } from "./lib/repos";
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
  } = useCachedPromise(searchMyPRs, [], {
    initialData: [] as PR[],
    keepPreviousData: true,
    onError: (e) => {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to load PRs",
        message: String(e),
      });
    },
  });

  // CI status for every PR in ONE batched gh call, refreshed whenever the list
  // changes (CI is volatile, so it's fetched fresh rather than persisted).
  const [ci, setCi] = useState<Map<string, CiStatus>>(new Map());
  useEffect(() => {
    if (prs.length === 0) return;
    let cancelled = false;
    prCiStatuses(prs)
      .then((m) => {
        if (!cancelled) setCi(m);
      })
      .catch(() => {
        /* CI is best-effort; the list still works without it */
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
      return undefined; // "none" → no accessory (PR genuinely has no checks)
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
      // Built-in search only sees title/subtitle/keywords — the repo is an
      // accessory, so add it (owner/repo + short name) and the number here.
      keywords={[pr.repo, shortRepo(pr.repo), `#${pr.number}`]}
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

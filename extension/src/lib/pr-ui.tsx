// Shared building blocks for the two cross-repo PR commands (My PRs, PRs to
// Review), which are otherwise near-identical: a cached list + batched CI +
// per-repo counts, a repo Scope dropdown, the CI accessory, and row keywords.
// Each command keeps only its own row actions.

import { List, Icon, Color, showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { PR, CiStatus, prCiStatuses, ciKey } from "./gh";

export { ciKey };

// The repo's short name — what you'd type to find it (`owner/foo` → `foo`).
export function shortRepo(repo: string): string {
  return repo.split("/").pop() || repo;
}

// Search sees title/subtitle/keywords only — the repo is an accessory, so add it
// (owner/repo + short name), the number, and the author so all are searchable.
export function prKeywords(pr: PR): string[] {
  return [
    pr.repo,
    shortRepo(pr.repo),
    `#${pr.number}`,
    ...(pr.author ? [pr.author] : []),
  ];
}

export function ciAccessory(ci?: CiStatus): List.Item.Accessory | undefined {
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

// Cached PR list (instant open, background revalidate) + CI for every PR in one
// batched call, refreshed when the list changes + per-repo counts for the
// dropdown. `fetchFn` is searchMyPRs or searchReviewRequests.
export function usePRList(fetchFn: () => Promise<PR[]>, errorTitle: string) {
  const {
    data: prs = [],
    isLoading,
    revalidate,
  } = useCachedPromise(fetchFn, [], {
    initialData: [] as PR[],
    keepPreviousData: true,
    onError: (e) => {
      showToast({
        style: Toast.Style.Failure,
        title: errorTitle,
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

  return { prs, ci, isLoading, revalidate, repos };
}

// The repo Scope dropdown (per-repo counts, most-first) used as searchBarAccessory.
export function RepoScopeDropdown({
  scope,
  onChange,
  repos,
}: {
  scope: string;
  onChange: (value: string) => void;
  repos: [string, number][];
}) {
  return (
    <List.Dropdown tooltip="Repo" value={scope} onChange={onChange}>
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
  );
}

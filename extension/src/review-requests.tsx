// PRs to Review — cross-repo list of PRs where someone requested YOUR review.
// Primary action hands the PR to `claude /review`, cloning the repo on demand
// if you don't have it locally. SPEC §5.2 (review side).

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
import { searchReviewRequests, prCiStatus, PR, CiStatus } from "./lib/gh";
import { reviewPR } from "./lib/claude";
import { resolveRepoPath } from "./lib/repos";
import { prefs } from "./lib/prefs";

export default function Command() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [ci, setCi] = useState<Record<string, CiStatus>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await searchReviewRequests();
        setPrs(list);
        setIsLoading(false);
        const entries = await Promise.all(
          list.map(
            async (p) => [p.url, await prCiStatus(p.repo, p.number)] as const,
          ),
        );
        setCi(Object.fromEntries(entries));
      } catch (e) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load review requests",
          message: String(e),
        });
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search PRs awaiting your review…"
    >
      {!isLoading && prs.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.Eye, tintColor: Color.Red }}
          title="No PRs to review"
          description="Nothing is waiting on your review right now."
        />
      )}
      {prs.map((pr) => (
        <PRItem key={pr.url} pr={pr} ci={ci[pr.url]} />
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

function PRItem({ pr, ci }: { pr: PR; ci?: CiStatus }) {
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
        </ActionPanel>
      }
    />
  );
}

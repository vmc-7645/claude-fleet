// My PRs — cross-repo list of your open PRs with CI status; each row → Review in
// Claude / Check out & work / Resume PR agent. SPEC §5.2.

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
import { searchMyPRs, prCiStatus, PR, CiStatus } from "./lib/gh";
import { reviewPR, checkoutAndWork, resumeFromPr } from "./lib/claude";
import { repoPath } from "./lib/repos";
import { prefs } from "./lib/prefs";

export default function Command() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [ci, setCi] = useState<Record<string, CiStatus>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await searchMyPRs();
        setPrs(list);
        setIsLoading(false);
        // CI status per PR, in parallel (one gh call each).
        const entries = await Promise.all(
          list.map(
            async (p) => [p.url, await prCiStatus(p.repo, p.number)] as const,
          ),
        );
        setCi(Object.fromEntries(entries));
      } catch (e) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load PRs",
          message: String(e),
        });
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search your open PRs…">
      {!isLoading && prs.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.CodeBlock, tintColor: Color.Blue }}
          title="No open PRs"
          description="Your open pull requests across repos show up here."
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
      return undefined; // "none" → no accessory (PR genuinely has no checks)
  }
}

function PRItem({ pr, ci }: { pr: PR; ci?: CiStatus }) {
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
        </ActionPanel>
      }
    />
  );
}

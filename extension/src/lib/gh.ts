// GitHub queries via the gh CLI. SPEC §6.4.

import { run } from "./exec";

export interface PR {
  number: number;
  title: string;
  repo: string; // owner/repo
  url: string;
  state: string;
  isDraft: boolean;
  author?: string; // login of the PR author (shown when reviewing others' PRs)
}

interface RawPR {
  number: number;
  title: string;
  url: string;
  state?: string;
  isDraft?: boolean;
  repository?: { name?: string; nameWithOwner?: string };
  author?: { login?: string };
}

const PR_FIELDS = "number,title,repository,url,state,isDraft,author";

// Pure JSON → PR[] mapping (exported for tests).
export function parsePRs(json: string): PR[] {
  const rows = JSON.parse(json) as RawPR[];
  return rows.map((r) => ({
    number: r.number,
    title: r.title,
    repo: r.repository?.nameWithOwner || r.repository?.name || "",
    url: r.url,
    state: r.state || "open",
    isDraft: !!r.isDraft,
    author: r.author?.login || undefined,
  }));
}

// Cross-repo list of the user's open PRs (SPEC §7 — no cwd needed).
export async function searchMyPRs(): Promise<PR[]> {
  const out = await run("gh", [
    "search",
    "prs",
    "--author=@me",
    "--state=open",
    "--limit",
    "50",
    "--sort",
    "updated",
    "--json",
    PR_FIELDS,
  ]);
  return parsePRs(out);
}

// Open PRs awaiting YOUR review (someone requested you). Cross-repo.
export async function searchReviewRequests(): Promise<PR[]> {
  const out = await run("gh", [
    "search",
    "prs",
    "--review-requested=@me",
    "--state=open",
    "--limit",
    "50",
    "--sort",
    "updated",
    "--json",
    PR_FIELDS,
  ]);
  return parsePRs(out);
}

// "none" = the PR genuinely has no checks; "unknown" = we couldn't fetch them
// (gh failed / offline) — the two must not look alike.
export type CiStatus = "pass" | "fail" | "pending" | "none" | "unknown";

interface RollupCheck {
  conclusion?: string;
  state?: string;
  status?: string;
}

// CI rollup for a single PR. One gh call per PR (fetched in parallel by the UI).
export async function prCiStatus(
  repo: string,
  number: number,
): Promise<CiStatus> {
  try {
    const out = await run("gh", [
      "pr",
      "view",
      String(number),
      "-R",
      repo,
      "--json",
      "statusCheckRollup",
    ]);
    const rollup = ((JSON.parse(out) as { statusCheckRollup?: RollupCheck[] })
      .statusCheckRollup || []) as RollupCheck[];
    if (rollup.length === 0) return "none";
    let pending = false;
    for (const c of rollup) {
      const concl = (c.conclusion || "").toUpperCase();
      const state = (c.state || "").toUpperCase();
      const status = (c.status || "").toUpperCase();
      const failed =
        [
          "FAILURE",
          "TIMED_OUT",
          "CANCELLED",
          "ACTION_REQUIRED",
          "STARTUP_FAILURE",
          "ERROR",
        ].includes(concl) || ["FAILURE", "ERROR"].includes(state);
      if (failed) return "fail";
      if (
        ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"].includes(status) ||
        state === "PENDING"
      )
        pending = true;
    }
    return pending ? "pending" : "pass";
  } catch {
    return "unknown"; // couldn't fetch — distinct from a PR with no checks
  }
}

export interface Issue {
  number: number;
  title: string;
  repo: string;
  url: string;
}

interface RawIssue {
  number: number;
  title: string;
  url: string;
  isPullRequest?: boolean;
  repository?: { name?: string; nameWithOwner?: string };
}

// Cross-repo list of open issues you opened (excluding PRs). The default gh
// limit is 30; we ask for 1000 — the GitHub search API's hard ceiling — so a
// heavy issue history isn't silently truncated (gh pages 100 at a time and stops
// when results run out, so it's only a few calls in practice).
export async function searchMyIssues(): Promise<Issue[]> {
  const out = await run("gh", [
    "search",
    "issues",
    "--author=@me",
    "--state=open",
    "--limit",
    "1000",
    "--sort",
    "updated",
    "--json",
    "number,title,repository,url,isPullRequest",
  ]);
  const rows = JSON.parse(out) as RawIssue[];
  return rows
    .filter((r) => !r.isPullRequest)
    .map((r) => ({
      number: r.number,
      title: r.title,
      repo: r.repository?.nameWithOwner || r.repository?.name || "",
      url: r.url,
    }));
}

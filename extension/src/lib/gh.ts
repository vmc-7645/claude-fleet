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
    "1000",
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
    "1000",
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

// Key a CI result by repo + number (PRs from different repos can share a number).
export function ciKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

// Map a GraphQL statusCheckRollup.state to our CiStatus. `null` node = the alias
// couldn't resolve (repo/PR gone) → unknown; a resolved PR with no rollup = none.
function rollupToCi(node: unknown): CiStatus {
  const pr = (node as { pullRequest?: unknown } | null)?.pullRequest as
    | {
        commits?: {
          nodes?: {
            commit?: { statusCheckRollup?: { state?: string } | null };
          }[];
        };
      }
    | null
    | undefined;
  if (pr == null) return "unknown"; // repo/PR didn't resolve
  const state =
    pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state?.toUpperCase();
  if (!state) return "none"; // resolved, but genuinely no checks
  if (state === "SUCCESS") return "pass";
  if (state === "FAILURE" || state === "ERROR") return "fail";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "unknown";
}

// CI rollup for MANY PRs in ONE `gh api graphql` call — replaces one `gh`
// subprocess per PR (up to N parallel process spawns). Keyed by ciKey(). gh
// exits non-zero if any single alias errors, but still writes the full partial
// JSON to stdout (Node attaches it to the thrown error's `.stdout`), so a few
// gone/renamed PRs just map to "unknown" without failing the batch.
export async function prCiStatuses(
  prs: { repo: string; number: number }[],
): Promise<Map<string, CiStatus>> {
  const out = new Map<string, CiStatus>();
  if (prs.length === 0) return out;

  const fields = prs
    .map((pr, i) => {
      const [owner, name = ""] = pr.repo.split("/");
      return `p${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(
        name,
      )}) { pullRequest(number: ${pr.number}) { commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }`;
    })
    .join("\n");
  const query = `query {\n${fields}\n}`;

  let raw = "";
  try {
    raw = await run("gh", ["api", "graphql", "-f", `query=${query}`]);
  } catch (e) {
    // Partial errors still deliver the full JSON on stdout; use it if present.
    const stdout = (e as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.includes('"data"')) raw = stdout;
    else {
      for (const pr of prs) out.set(ciKey(pr.repo, pr.number), "unknown");
      return out;
    }
  }

  let data: Record<string, unknown> = {};
  try {
    data = (JSON.parse(raw) as { data?: Record<string, unknown> }).data || {};
  } catch {
    for (const pr of prs) out.set(ciKey(pr.repo, pr.number), "unknown");
    return out;
  }
  prs.forEach((pr, i) => {
    out.set(ciKey(pr.repo, pr.number), rollupToCi(data[`p${i}`]));
  });
  return out;
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

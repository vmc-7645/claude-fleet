// GitHub queries via the gh CLI. SPEC §6.4.

import { run } from "./exec";

export interface PR {
  number: number;
  title: string;
  repo: string; // owner/repo
  url: string;
  state: string;
  isDraft: boolean;
}

interface RawPR {
  number: number;
  title: string;
  url: string;
  state?: string;
  isDraft?: boolean;
  repository?: { name?: string; nameWithOwner?: string };
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
    "number,title,repository,url,state,isDraft",
  ]);
  const rows = JSON.parse(out) as RawPR[];
  return rows.map((r) => ({
    number: r.number,
    title: r.title,
    repo: r.repository?.nameWithOwner || r.repository?.name || "",
    url: r.url,
    state: r.state || "open",
    isDraft: !!r.isDraft,
  }));
}

// Discover local repos, reusing the config at
// ~/.config/claude-code-for-raycast/repos.env (REPO_ROOT + DEFAULT_REPO). The
// legacy ~/.config/claude-mac-tweaks/repos.env path is still read for
// back-compat. An optional override (from the extension preference) wins over
// the config. SPEC §7.

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { run } from "./exec";

export interface Repo {
  name: string;
  path: string;
  mtime: number; // recency signal (max of dir / .git / .git/HEAD mtime)
}

// A repo on GitHub you can access but may not have cloned yet.
export interface RemoteRepo {
  nameWithOwner: string; // owner/name — also the dropdown value
  name: string;
  pushedAt: string; // ISO; used for recency sort
}

const MAX_REPOS = 50;
const MAX_REMOTE = 300; // guard a pathological account; recency-sorted first

function recency(path: string): number {
  let m = 0;
  for (const p of [path, join(path, ".git"), join(path, ".git", "HEAD")]) {
    try {
      m = Math.max(m, statSync(p).mtimeMs);
    } catch {
      // skip
    }
  }
  return m;
}

function expand(p: string): string {
  return p.replace(/^~(?=$|\/)/, homedir());
}

// Preferred config path first; the legacy claude-mac-tweaks path is read only
// if the new one is absent (back-compat). First file that exists wins.
const CONFIG_PATHS = [
  join(homedir(), ".config", "claude-code-for-raycast", "repos.env"),
  join(homedir(), ".config", "claude-mac-tweaks", "repos.env"),
];

export function reposConfig(overrideRoot?: string): { root: string; defaultRepo?: string } {
  let root = join(homedir(), "Repos");
  let defaultRepo: string | undefined;
  for (const cfg of CONFIG_PATHS) {
    let text: string;
    try {
      text = readFileSync(cfg, "utf8");
    } catch {
      continue; // not present — try the next candidate
    }
    for (const line of text.split("\n")) {
      const r = line.match(/^REPO_ROOT="?([^"]*)"?/);
      if (r) root = expand(r[1]);
      const d = line.match(/^DEFAULT_REPO="?([^"]*)"?/);
      if (d && d[1]) defaultRepo = d[1];
    }
    break; // first config found wins; don't let the legacy file override it
  }
  if (overrideRoot && overrideRoot.trim()) root = expand(overrideRoot.trim());
  return { root, defaultRepo };
}

export function listRepos(overrideRoot?: string): Repo[] {
  const { root } = reposConfig(overrideRoot);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: Repo[] = [];
  for (const name of entries) {
    if (name.endsWith("-worktrees")) continue;
    const path = join(root, name);
    if (existsSync(join(path, ".git"))) out.push({ name, path, mtime: recency(path) });
  }
  // Most-recently-active first, capped so a huge repos dir stays manageable.
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, MAX_REPOS);
}

export function repoPath(nameOrOwnerRepo: string, overrideRoot?: string): string | undefined {
  const { root } = reposConfig(overrideRoot);
  const name = nameOrOwnerRepo.includes("/") ? nameOrOwnerRepo.split("/").pop()! : nameOrOwnerRepo;
  const p = join(root, name);
  return existsSync(join(p, ".git")) ? p : undefined;
}

interface RawRemote {
  full_name?: string;
  name?: string;
  pushed_at?: string;
}

// Every repo you can access on GitHub (owned, collaborator, org member), most
// recently pushed first. One `gh api` call; capped so a huge account stays sane.
export async function listRemoteRepos(): Promise<RemoteRepo[]> {
  let out: string;
  try {
    out = await run("gh", [
      "api",
      "--paginate",
      "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    ]);
  } catch {
    return []; // not authed / offline — remote tier just stays empty
  }
  let rows: RawRemote[] = [];
  try {
    rows = JSON.parse(out) as RawRemote[]; // gh merges paginated arrays into one
  } catch {
    return [];
  }
  return rows
    .filter((r) => r.full_name)
    .map((r) => ({ nameWithOwner: r.full_name!, name: r.name || r.full_name!.split("/").pop()!, pushedAt: r.pushed_at || "" }))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
    .slice(0, MAX_REMOTE);
}

// Clone a remote repo into the repos root (idempotent) and return its local path.
export async function cloneRepo(nameWithOwner: string, overrideRoot?: string): Promise<string> {
  const { root } = reposConfig(overrideRoot);
  const name = nameWithOwner.split("/").pop()!;
  const target = join(root, name);
  if (existsSync(join(target, ".git"))) return target; // already have it
  await run("gh", ["repo", "clone", nameWithOwner, target]);
  return target;
}

// Resolve a dropdown value to a local path. Bare name → existing local repo;
// "owner/name" → a remote repo, cloned on demand. Returns undefined if a local
// value doesn't resolve.
export async function resolveRepoPath(value: string, overrideRoot?: string): Promise<string | undefined> {
  if (value.includes("/")) return cloneRepo(value, overrideRoot);
  return repoPath(value, overrideRoot);
}

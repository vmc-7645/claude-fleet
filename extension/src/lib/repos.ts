// Discover local repos, reusing the shell tweaks' config
// (~/.config/claude-mac-tweaks/repos.env: REPO_ROOT + DEFAULT_REPO). An optional
// override (from the extension preference) wins over the config. SPEC §7.

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface Repo {
  name: string;
  path: string;
  mtime: number; // recency signal (max of dir / .git / .git/HEAD mtime)
}

const MAX_REPOS = 50;

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

export function reposConfig(overrideRoot?: string): { root: string; defaultRepo?: string } {
  const cfg = join(homedir(), ".config", "claude-mac-tweaks", "repos.env");
  let root = join(homedir(), "Repos");
  let defaultRepo: string | undefined;
  try {
    for (const line of readFileSync(cfg, "utf8").split("\n")) {
      const r = line.match(/^REPO_ROOT="?([^"]*)"?/);
      if (r) root = expand(r[1]);
      const d = line.match(/^DEFAULT_REPO="?([^"]*)"?/);
      if (d && d[1]) defaultRepo = d[1];
    }
  } catch {
    // defaults
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

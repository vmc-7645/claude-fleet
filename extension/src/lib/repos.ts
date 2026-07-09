// Discover local repos, reusing the shell tweaks' config
// (~/.config/claude-mac-tweaks/repos.env: REPO_ROOT + DEFAULT_REPO). This is the
// dynamic version of the shell dropdowns (SPEC §7).

import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface Repo {
  name: string;
  path: string;
}

export function reposConfig(): { root: string; defaultRepo?: string } {
  const cfg = join(homedir(), ".config", "claude-mac-tweaks", "repos.env");
  let root = join(homedir(), "Repos");
  let defaultRepo: string | undefined;
  try {
    for (const line of readFileSync(cfg, "utf8").split("\n")) {
      const r = line.match(/^REPO_ROOT="?([^"]*)"?/);
      if (r) root = r[1].replace(/^~/, homedir());
      const d = line.match(/^DEFAULT_REPO="?([^"]*)"?/);
      if (d && d[1]) defaultRepo = d[1];
    }
  } catch {
    // defaults
  }
  return { root, defaultRepo };
}

export function listRepos(): Repo[] {
  const { root } = reposConfig();
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
    if (existsSync(join(path, ".git"))) out.push({ name, path });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Resolve a repo name (or owner/repo) to a local path under the root, if cloned.
export function repoPath(nameOrOwnerRepo: string): string | undefined {
  const { root } = reposConfig();
  const name = nameOrOwnerRepo.includes("/") ? nameOrOwnerRepo.split("/").pop()! : nameOrOwnerRepo;
  const p = join(root, name);
  return existsSync(join(p, ".git")) ? p : undefined;
}

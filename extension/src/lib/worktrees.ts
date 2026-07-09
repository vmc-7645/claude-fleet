// List git worktrees across your repos, and remove them. SPEC §5.8.

import { run } from "./exec";
import { listRepos } from "./repos";

export interface Worktree {
  repo: string;
  path: string;
  branch: string;
  isMain: boolean;
  mainPath: string; // the repo's primary worktree (where `remove` is run from)
}

export async function listWorktrees(overrideRoot?: string): Promise<Worktree[]> {
  const repos = listRepos(overrideRoot);
  const out: Worktree[] = [];
  for (const r of repos) {
    let txt: string;
    try {
      txt = await run("git", ["-C", r.path, "worktree", "list", "--porcelain"]);
    } catch {
      continue;
    }
    let path = "";
    let branch = "";
    const flush = () => {
      if (path) out.push({ repo: r.name, path, branch, isMain: path === r.path, mainPath: r.path });
      path = "";
      branch = "";
    };
    for (const line of txt.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        path = line.slice("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "detached") {
        branch = "(detached)";
      }
    }
    flush();
  }
  return out;
}

export async function removeWorktree(wt: Worktree): Promise<void> {
  await run("git", ["-C", wt.mainPath, "worktree", "remove", wt.path, "--force"]);
}

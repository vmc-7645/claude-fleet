// Review PR — inline (no-view) command: type the PR number and pick the repo
// right in the Raycast search bar, then it opens Claude on /review. SPEC §5.4.

import { LaunchProps, showToast, Toast, showHUD, closeMainWindow } from "@raycast/api";
import { reviewPR } from "./lib/claude";
import { repoPath } from "./lib/repos";

interface Args {
  pr: string;
  repo: string;
}

export default async function Command(props: LaunchProps<{ arguments: Args }>) {
  const { pr, repo } = props.arguments;

  // Accept "349" or "owner/repo#349" / "repo#349" in the number field.
  let repoName = repo;
  let numStr = pr;
  const hash = pr.indexOf("#");
  if (hash >= 0) {
    repoName = pr.slice(0, hash) || repo;
    numStr = pr.slice(hash + 1);
  }
  const n = parseInt(numStr, 10);
  if (!n || Number.isNaN(n)) {
    await showToast({ style: Toast.Style.Failure, title: "Enter a PR number" });
    return;
  }

  const local = repoPath(repoName);
  if (!local) {
    await showToast({ style: Toast.Style.Failure, title: "Repo not found locally", message: repoName });
    return;
  }

  await closeMainWindow();
  try {
    await reviewPR(local, n);
    await showHUD(`Reviewing ${repoName}#${n}`);
  } catch (e) {
    await showHUD(`❌ ${String(e).slice(0, 80)}`);
  }
}

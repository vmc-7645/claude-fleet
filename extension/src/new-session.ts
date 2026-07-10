// New Session — inline: pick a repo, start a fresh Claude session there (no worktree).

import { LaunchProps, showToast, Toast, showHUD, closeMainWindow } from "@raycast/api";
import { newSessionInRepo } from "./lib/claude";
import { repoPath } from "./lib/repos";
import { prefs } from "./lib/prefs";

export default async function Command(props: LaunchProps<{ arguments: { repo: string } }>) {
  const local = repoPath(props.arguments.repo, prefs().reposRoot);
  if (!local) {
    await showToast({ style: Toast.Style.Failure, title: "Repo not found locally", message: props.arguments.repo });
    return;
  }
  await closeMainWindow();
  try {
    await newSessionInRepo(local);
    await showHUD(`New Claude session in ${props.arguments.repo}`);
  } catch (e) {
    await showHUD(`❌ ${String(e).slice(0, 80)}`);
  }
}

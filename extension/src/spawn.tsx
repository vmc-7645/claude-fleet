// Spawn Agent — pick a repo, give a task (+optional branch), and launch an
// agent in a fresh worktree. SPEC §5.3.

import { Form, ActionPanel, Action, Icon, showToast, Toast, showHUD, closeMainWindow, popToRoot } from "@raycast/api";
import { useState } from "react";
import { listRepos, reposConfig } from "./lib/repos";
import { spawnAgent } from "./lib/claude";

function slug(task: string): string {
  const s = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "task";
}

export default function Command() {
  const repos = listRepos();
  const { defaultRepo } = reposConfig();
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repoName = String(values.repo || "");
    const task = String(values.task || "").trim();
    const branchIn = String(values.branch || "").trim();
    const repo = repos.find((r) => r.name === repoName);
    if (!repo) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    const branch = branchIn || `agent/${slug(task || "task")}`;
    setLoading(true);
    await closeMainWindow();
    try {
      await spawnAgent(repo.path, branch, task || undefined);
      await showHUD(`Spawned ${repo.name}:${branch}`);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
      setLoading(false);
    }
  }

  return (
    <Form
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Spawn Agent" icon={Icon.Rocket} onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="repo" title="Repo" defaultValue={defaultRepo}>
        {repos.map((r) => (
          <Form.Dropdown.Item key={r.name} value={r.name} title={r.name} />
        ))}
      </Form.Dropdown>
      <Form.TextField id="task" title="Task" placeholder="what should the agent do?" />
      <Form.TextField id="branch" title="Branch" placeholder="optional — defaults to agent/<slug>" />
    </Form>
  );
}

// New Session — pick a repo (dynamic, recency-sorted) and start a fresh Claude
// session there (no worktree).

import { Form, ActionPanel, Action, Icon, showToast, Toast, showHUD, closeMainWindow, popToRoot } from "@raycast/api";
import { useState } from "react";
import { listRepos, reposConfig } from "./lib/repos";
import { newSessionInRepo } from "./lib/claude";
import { prefs } from "./lib/prefs";

export default function Command() {
  const root = prefs().reposRoot;
  const repos = listRepos(root);
  const { defaultRepo } = reposConfig(root);
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repo = repos.find((r) => r.name === String(values.repo || ""));
    if (!repo) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    setLoading(true);
    await closeMainWindow();
    try {
      await newSessionInRepo(repo.path);
      await showHUD(`New Claude session in ${repo.name}`);
      await popToRoot();
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
          <Action.SubmitForm title="Start Session" icon={Icon.Terminal} onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="repo" title="Repo" defaultValue={defaultRepo || repos[0]?.name}>
        {repos.map((r) => (
          <Form.Dropdown.Item key={r.name} value={r.name} title={r.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

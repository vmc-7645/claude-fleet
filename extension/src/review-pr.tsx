// Review PR — pick a repo + PR number, open Claude to review it. SPEC §5.4.

import { Form, ActionPanel, Action, Icon, showToast, Toast, showHUD, closeMainWindow, popToRoot } from "@raycast/api";
import { useState } from "react";
import { listRepos, reposConfig } from "./lib/repos";
import { reviewPR } from "./lib/claude";

export default function Command() {
  const repos = listRepos();
  const { defaultRepo } = reposConfig();
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repoName = String(values.repo || "");
    const n = parseInt(String(values.pr || ""), 10);
    const repo = repos.find((r) => r.name === repoName);
    if (!repo) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    if (!n || Number.isNaN(n)) {
      await showToast({ style: Toast.Style.Failure, title: "Enter a PR number" });
      return;
    }
    setLoading(true);
    try {
      await reviewPR(repo.path, n);
      await showHUD(`Reviewing ${repo.name}#${n}`);
      await closeMainWindow();
      await popToRoot();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed", message: String(e) });
      setLoading(false);
    }
  }

  return (
    <Form
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Review PR in Claude" icon={Icon.MagnifyingGlass} onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="repo" title="Repo" defaultValue={defaultRepo}>
        {repos.map((r) => (
          <Form.Dropdown.Item key={r.name} value={r.name} title={r.name} />
        ))}
      </Form.Dropdown>
      <Form.TextField id="pr" title="PR Number" placeholder="e.g. 349" />
    </Form>
  );
}

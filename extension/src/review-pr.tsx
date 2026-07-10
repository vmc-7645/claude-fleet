// Review PR — pick a repo (dynamic, recency-sorted) + PR number, open Claude to
// review it. SPEC §5.4.

import { Form, ActionPanel, Action, Icon, showToast, Toast, showHUD, closeMainWindow, popToRoot } from "@raycast/api";
import { useState } from "react";
import { listRepos, reposConfig } from "./lib/repos";
import { reviewPR } from "./lib/claude";
import { prefs } from "./lib/prefs";

export default function Command() {
  const root = prefs().reposRoot;
  const repos = listRepos(root);
  const { defaultRepo } = reposConfig(root);
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repo = repos.find((r) => r.name === String(values.repo || ""));
    const n = parseInt(String(values.pr || ""), 10);
    if (!repo) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    if (!n || Number.isNaN(n)) {
      await showToast({ style: Toast.Style.Failure, title: "Enter a PR number" });
      return;
    }
    setLoading(true);
    await closeMainWindow();
    try {
      await reviewPR(repo.path, n);
      await showHUD(`Reviewing ${repo.name}#${n}`);
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
          <Action.SubmitForm title="Review PR in Claude" icon={Icon.MagnifyingGlass} onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="pr" title="PR Number" placeholder="e.g. 349" />
      <Form.Dropdown id="repo" title="Repo" defaultValue={defaultRepo || repos[0]?.name}>
        {repos.map((r) => (
          <Form.Dropdown.Item key={r.name} value={r.name} title={r.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

// Skills — manage your custom slash-command skills (~/.claude/skills).

import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Form,
  showHUD,
  closeMainWindow,
  useNavigation,
} from "@raycast/api";
import { useState } from "react";
import { listSkills, toggleSkill, createSkill, Skill } from "./lib/skills";
import { openInEditor } from "./lib/claude";
import { prefs } from "./lib/prefs";

export default function Command() {
  const [skills, setSkills] = useState<Skill[]>(listSkills());
  const { push } = useNavigation();
  const reload = () => setSkills(listSkills());

  return (
    <List searchBarPlaceholder="Search skills / commands…">
      {skills.length === 0 && <List.EmptyView icon="🧩" title="No custom skills" description="Create one below." />}
      {skills.map((s) => (
        <List.Item
          key={s.name}
          icon={s.disabled ? Icon.CircleDisabled : "🧩"}
          title={`/${s.name}`}
          subtitle={s.description}
          accessories={s.disabled ? [{ tag: { value: "disabled", color: Color.SecondaryText } }] : []}
          actions={
            <ActionPanel>
              <Action
                title="Edit"
                icon={Icon.Pencil}
                onAction={async () => {
                  await closeMainWindow();
                  await openInEditor(s.path, prefs().editorCommand || "code");
                }}
              />
              <Action
                title={s.disabled ? "Enable" : "Disable"}
                icon={s.disabled ? Icon.Check : Icon.XMarkCircle}
                onAction={() => {
                  toggleSkill(s);
                  reload();
                }}
              />
              <Action.ShowInFinder path={s.dir} />
              <Action title="New Skill…" icon={Icon.Plus} onAction={() => push(<NewSkill onDone={reload} />)} />
            </ActionPanel>
          }
        />
      ))}
      <List.Item
        icon={Icon.Plus}
        title="New Skill…"
        actions={
          <ActionPanel>
            <Action title="New Skill…" icon={Icon.Plus} onAction={() => push(<NewSkill onDone={reload} />)} />
          </ActionPanel>
        }
      />
    </List>
  );
}

function NewSkill({ onDone }: { onDone: () => void }) {
  const { pop } = useNavigation();
  async function submit(values: Form.Values) {
    const name = String(values.name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!name) return;
    const file = createSkill(name);
    onDone();
    pop();
    await closeMainWindow();
    await openInEditor(file, prefs().editorCommand || "code");
    await showHUD(`Created /${name}`);
  }
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Skill" icon={Icon.Plus} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Command name" placeholder="e.g. standup (becomes /standup)" />
    </Form>
  );
}

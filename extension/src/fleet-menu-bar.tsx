// Fleet — ambient menu-bar indicator: a count of agents needing you + a roster.
// Reads the same data as the Agents command. SPEC §5.5.

import { MenuBarExtra, launchCommand, LaunchType, open } from "@raycast/api";
import { loadAgents } from "./lib/rank";
import { Agent } from "./lib/types";
import { jumpToGhostty } from "./lib/claude";

function icon(a: Agent): string {
  switch (a.state) {
    case "working":
      return "⚙️";
    case "waiting":
      return "🔔";
    case "done":
      return "✅";
    default:
      return "💤";
  }
}

function label(a: Agent): string {
  const t = a.title ? ` — ${a.title}` : "";
  return `${icon(a)} ${a.repo}${t}`;
}

export default function Command() {
  let active: Agent[] = [];
  try {
    active = loadAgents().active;
  } catch {
    active = [];
  }

  // "Needs you" = anything active that isn't actively working.
  const needsYou = active.filter((a) => a.state !== "working");
  const working = active.filter((a) => a.state === "working");

  // Icon-only when nothing needs you (SPEC §18: badge = needs-you count).
  const title = needsYou.length > 0 ? String(needsYou.length) : undefined;

  return (
    <MenuBarExtra icon="🤖" title={title} tooltip="Claude agents">
      <MenuBarExtra.Section title={`Needs you (${needsYou.length})`}>
        {needsYou.map((a) => (
          <MenuBarExtra.Item
            key={a.sessionId}
            title={label(a)}
            subtitle={a.state === "waiting" && a.stateReason ? a.stateReason : undefined}
            onAction={() => jumpToGhostty()}
          />
        ))}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title={`Working (${working.length})`}>
        {working.map((a) => (
          <MenuBarExtra.Item
            key={a.sessionId}
            title={label(a)}
            subtitle={a.lastTool}
            onAction={() => jumpToGhostty()}
          />
        ))}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Open Agents…"
          onAction={() => launchCommand({ name: "agents", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item title="New Agent…" onAction={() => launchCommand({ name: "spawn", type: LaunchType.UserInitiated })} />
        <MenuBarExtra.Item title="Fleet folder" onAction={() => open(`${process.env.HOME}/.claude/fleet`)} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

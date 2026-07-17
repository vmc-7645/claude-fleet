// Fleet — ambient menu-bar indicator: a count of agents needing you + a roster.
// Reads the same data as the Agents command. SPEC §5.5.

import {
  MenuBarExtra,
  Icon,
  Color,
  Image,
  launchCommand,
  LaunchType,
  open,
} from "@raycast/api";
import { loadAgents } from "./lib/rank";
import { Agent } from "./lib/types";
import { focusOrRaise } from "./lib/claude";

// Clean, unstyled state icons for the dropdown rows (no logo/outline).
function stateIcon(a: Agent): Image.ImageLike {
  switch (a.state) {
    case "working":
      return { source: Icon.Gear, tintColor: Color.Blue };
    case "waiting":
      return { source: Icon.Bell, tintColor: Color.Orange };
    case "done":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    default:
      return { source: Icon.Moon, tintColor: Color.SecondaryText };
  }
}

function label(a: Agent): string {
  const t = a.title ? ` — ${a.title}` : "";
  return `${a.repo}${t}`;
}

export default function Command() {
  let active: Agent[] = [];
  try {
    active = loadAgents({ activeOnly: true }).active;
  } catch {
    active = [];
  }

  // "Needs you" = anything active that isn't actively working.
  const needsYou = active.filter((a) => a.state !== "working");
  const working = active.filter((a) => a.state === "working");

  // Icon-only when nothing needs you (SPEC §18: badge = needs-you count).
  const title = needsYou.length > 0 ? String(needsYou.length) : undefined;

  // Claude spark (Anthropic press kit), themed to the menu bar: dark glyph on a
  // light bar, white on a dark bar. The count carries the "needs you" signal.
  // See assets/NOTICE.md.
  const icon = {
    source: { light: "claude-spark-dark.svg", dark: "claude-spark-light.svg" },
  };

  return (
    <MenuBarExtra icon={icon} title={title} tooltip="Claude agents">
      <MenuBarExtra.Section title={`Needs you (${needsYou.length})`}>
        {needsYou.map((a) => (
          <MenuBarExtra.Item
            key={a.sessionId}
            icon={stateIcon(a)}
            title={label(a)}
            subtitle={
              a.state === "waiting" && a.stateReason ? a.stateReason : undefined
            }
            onAction={() => focusOrRaise(a)}
          />
        ))}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title={`Working (${working.length})`}>
        {working.map((a) => (
          <MenuBarExtra.Item
            key={a.sessionId}
            icon={stateIcon(a)}
            title={label(a)}
            subtitle={a.lastTool}
            onAction={() => focusOrRaise(a)}
          />
        ))}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Open Agents…"
          icon={Icon.AppWindowList}
          onAction={() =>
            launchCommand({ name: "agents", type: LaunchType.UserInitiated })
          }
        />
        <MenuBarExtra.Item
          title="New Agent…"
          icon={Icon.Plus}
          onAction={() =>
            launchCommand({ name: "spawn", type: LaunchType.UserInitiated })
          }
        />
        <MenuBarExtra.Item
          title="Fleet folder"
          icon={Icon.Folder}
          onAction={() => open(`${process.env.HOME}/.claude/fleet`)}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

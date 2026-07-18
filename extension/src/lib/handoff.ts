// Handoff card — a self-contained markdown snapshot of an agent's state, to
// paste into Slack / a PR / notes, or share as a secret gist. Read-only: it
// moves *context*, not the session (see the note on cross-machine resume in the
// README). Safe to send anywhere in its compact form; the full form adds recent
// messages + the diff, which can carry sensitive content.

import { writeFileSync, unlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { run } from "./exec";
import { Agent } from "./types";
import { fullDiff, resumeCommand } from "./claude";
import { recentMessages } from "./history";

const STATE_EMOJI: Record<string, string> = {
  working: "⚙️",
  waiting: "🔔",
  done: "✅",
  idle: "💤",
};

function shortPath(p: string): string {
  const h = homedir();
  return p.startsWith(h) ? "~" + p.slice(h.length) : p;
}

function ageLabel(ms: number): string {
  if (!ms) return "";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

async function branchOf(cwd: string): Promise<string> {
  if (!cwd) return "";
  try {
    return (
      await run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  } catch {
    return "";
  }
}

const quote = (s: string) => s.replace(/\n/g, "\n> ");
const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n).trimEnd() + "…" : s;

// Build the handoff card. Compact by default; `full` adds the last few messages
// and the full diff.
export async function buildHandoffCard(
  agent: Agent,
  opts: { full?: boolean } = {},
): Promise<string> {
  const branch = await branchOf(agent.cwd);
  const emoji = STATE_EMOJI[agent.state] ?? "";
  const head = `${emoji} ${agent.repo}${branch ? `:${branch}` : ""}${
    agent.title ? ` — ${agent.title}` : ""
  }`.trim();

  const status: string[] = [agent.state];
  if (agent.state === "waiting" && agent.stateReason)
    status.push(agent.stateReason);
  if (agent.turns) status.push(`${agent.turns} turns`);
  const age = ageLabel(agent.updatedAt);
  if (age) status.push(`last active ${age}`);

  const out: string[] = [
    `### ${head}`,
    `**${status.join(" · ")}**`,
    `\`${shortPath(agent.cwd)}\`${agent.diff ? ` · ${agent.diff}` : ""}`,
  ];

  if (agent.question) {
    // It's a "pending question" only when the agent is actually waiting on you;
    // otherwise it's just the last thing said. Trim hard in the compact card.
    const label =
      agent.state === "waiting" ? "Pending question" : "Last message";
    const q = truncate(agent.question, opts.full ? 1200 : 280);
    out.push("", `**${label}**`, `> ${quote(q)}`);
  }

  if (opts.full && agent.transcriptPath) {
    const msgs = recentMessages(agent.transcriptPath, 6); // ~3 exchanges
    if (msgs.length) {
      out.push("", "**Recent**");
      for (const m of msgs) {
        const who = m.role === "u" ? "you" : "claude";
        out.push(`> **${who}:** ${m.text.replace(/\s+/g, " ").slice(0, 300)}`);
      }
    }
  }

  out.push("", `**Resume:** \`${resumeCommand(agent)}\``);

  if (opts.full) {
    const diff = await fullDiff(agent.cwd);
    if (diff) out.push("", "**Diff** (vs HEAD)", "```diff", diff, "```");
  }

  out.push("", `_handoff · session ${agent.sessionId.slice(0, 8)}_`);
  return out.join("\n");
}

// Create a SECRET (unlisted) gist from the card and return its URL. Writes the
// card to a temp file so we don't have to pipe stdin through execFile.
export async function shareGist(md: string, filename: string): Promise<string> {
  const safe = filename.replace(/[^\w.-]/g, "_");
  const tmp = join(tmpdir(), `${Date.now()}-${safe}`);
  writeFileSync(tmp, md, { mode: 0o600 });
  try {
    const out = await run("gh", [
      "gist",
      "create",
      "--secret",
      "-d",
      "Claude Fleet handoff",
      tmp,
    ]);
    // gh prints the gist URL as the last line.
    return out.trim().split("\n").pop() || "";
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort
    }
  }
}

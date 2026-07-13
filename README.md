<div align="center">

<img src="extension/assets/icon.png" width="104" alt="Claude Code for Raycast" />

# Claude Code for Raycast

**Your Claude Code agents, PRs, and worktrees — one keystroke away.**

See every dev surface in Raycast and hand any of it to an agent,
landing in a Ghostty tab. Plus an ambient menu-bar read on who needs you.

<p>
  <img alt="License MIT"        src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square" />
  <img alt="Platform macOS"     src="https://img.shields.io/badge/platform-macOS-8b8b8b?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Raycast extension"  src="https://img.shields.io/badge/Raycast-extension-FF6363?style=flat-square&logo=raycast&logoColor=white" />
  <img alt="Terminal Ghostty"   src="https://img.shields.io/badge/terminal-Ghostty-1d4ed8?style=flat-square" />
</p>

</div>

---

> [!NOTE]
> **Built and in daily use** as a local Raycast dev extension. Full design in **[SPEC.md](SPEC.md)**.
> **Liveness needs no hooks** — the extension reads Claude Code's *own* session registry
> (`~/.claude/sessions`) directly, so active agents show up out of the box. The bundled
> [helpers](helpers/) add the richer touches (Focus Tab, per-turn state, Spawn, Undo).

## The `→ Claude` primitive

Every dev surface — a PR, an issue, a running agent, a past session, a worktree — carries a
one-keystroke **hand it to an agent** action. That's the whole idea: stop context-switching to
a terminal to start work; start it from wherever you already are.

## Commands

Twelve commands, grouped by what you reach for.

#### 🤖 Agents & fleet
| Command | Mode | What it does |
|---|---|---|
| **Agents** | list | Active (live) + Recent (history) console. Per agent: **Focus Tab** (jumps to the exact Ghostty tab), Resume, Fork, **Nudge** (type a follow-up into its tab), **Close Tab**, Undo last turn, Stop, copy resume command, open in editor/folder. Detail pane (⌘I) shows the pending question + mode/state/diff. **Scope** dropdown (All / Active / Recent / per-repo). |
| **Claude Code Fleet** | menu bar | Needs-you count badge + roster; click an agent to focus its tab. Refreshes every minute. |

#### 🔀 PRs, issues & worktrees
| Command | Mode | What it does |
|---|---|---|
| **My PRs** | list | Cross-repo open PRs with **CI status** (✅ / ❌ / ⏳). Per PR: **Review in Claude**, **Check Out & Work** (worktree agent, or opens the existing worktree if the branch is already checked out), **Resume PR agent** (`--from-pr`). |
| **My Issues** | list | Cross-repo open issues → start an agent seeded with the issue. |
| **Review PR** | form | Type a PR number + pick a repo → `claude /review`. |
| **Worktrees** | list | Worktrees across repos; open / resume / **remove**; merged branches flagged 🍂. |

#### 🚀 Spawn & start
| Command | Mode | What it does |
|---|---|---|
| **Spawn Agent** | form | Repo + task (+ optional branch) → agent in a fresh worktree, seeded with the task. |
| **New Session** | form | Fresh Claude session in a repo (no worktree). |

#### ⚙️ Manage Claude Code
| Command | Mode | What it does |
|---|---|---|
| **MCP Servers** | list | Configured servers + live auth status; re-authenticate via `/mcp`. |
| **Skills** | list | Manage your custom slash-command skills — edit, enable/disable, create. |
| **Usage** | list | Estimated tokens & cost per session (today vs earlier), at API rates. |
| **Claude Code Config** | list | Edit settings / CLAUDE.md, inspect hooks / plugins, set model, run `doctor`, show version. |

> Repo pickers (Review PR · New Session · Spawn) are recency-sorted: your **local** repos first,
> then everything you can access on **GitHub** — remote picks are cloned on demand.

## Focus Tab — how it works

The `tab-status` hook titles each Ghostty tab `<emoji> <repo>:<branch> — <task>`. Ghostty exposes
tabs as a native `AXTabGroup` of `AXRadioButton`s (titles = those strings), so the extension
matches an agent to its tab by title and `AXPress`es it — jumping you straight there. No match →
it just raises Ghostty. (Enumeration is retried; System Events occasionally throws a flaky `-10000`.)

## Quick start

```sh
# 1 — install the shell commands + hooks, and wire them into ~/.claude/settings.json
helpers/install.sh          # idempotent; backs settings.json up first

# 2 — auth gh for My PRs / My Issues
gh auth login

# 3 — load the extension into Raycast (persists after you stop the dev server)
cd extension && npm ci && npm run dev
```

4. **Restart Claude Code** so the new hooks load.
5. **Grant Raycast Accessibility** — System Settings → Privacy & Security → Accessibility → enable
   Raycast. Required for the ⌘T / keystroke / tab-focus actions; `gh` reads work without it.

<details>
<summary><strong>Preferences</strong> (Raycast → Extensions → Claude Code → ⚙️)</summary>

<br>

- **Agent primary action** — Focus Tab vs Resume in New Tab (what Enter does on a live agent).
- **Editor command** — `code` / `cursor` / … for *Open in Editor* (must be on `PATH`).
- **Repos directory** — override discovery root. Blank → `~/.config/claude-code-for-raycast/repos.env`
  (legacy `claude-mac-tweaks` path still honored) → `~/Repos`.

</details>

## Under the hood

The extension is a thin, declarative UI over a few data sources it reads directly — no daemon,
no polling service, nothing to keep running.

<details>
<summary><strong>Where each fact comes from</strong></summary>

<br>

| Source | Gives |
|---|---|
| `~/.claude/sessions/*.json` | **Active** agents — Claude's own live registry (sessionId · cwd · pid · busy/idle). Authoritative liveness, **no hooks needed**. |
| `~/.claude/projects/*.jsonl` | **Recent** sessions — title (`aiTitle`), pending question (last assistant message), turn count, token usage. Parsed metadata is cached by file mtime. |
| `~/.claude/fleet/*.json` | Optional enrichment from the `fleet-register` hook — finer state (waiting / done), task label, diff, mode. |
| `gh` | Cross-repo PRs & issues, CI rollup, remote repo list. |

</details>

The local commands + hooks the extension drives are vendored in **[`helpers/`](helpers/)**
(`claude-worktree`, `claude-undo`, `claude-restore`, and the `tab-status` / `fleet-register` /
`checkpoint` hooks) — see [helpers/README](helpers/README.md). The extension degrades gracefully
without them: Focus Tab falls back to raising Ghostty; Spawn / Undo report the missing command.

## Requirements

macOS · [Ghostty](https://ghostty.org) · [`gh`](https://cli.github.com) · `jq` · `git` ·
Claude Code (≥ 2.1.141 for the tab-title hook).

## License

[MIT](LICENSE).

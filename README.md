# Claude Code for Raycast

A Raycast extension that integrates **Claude Code** into the launcher: see your
dev surfaces (PRs, issues, running agents, past sessions) and **hand any of them
to a Claude agent** — from anywhere, landing in a Ghostty tab. Plus an ambient
menu-bar indicator of who needs you.

> **Status:** built and in daily use (installed as a local Raycast dev extension).
> Full design in **[SPEC.md](SPEC.md)**.
>
> **How it knows about agents:** Claude Code maintains its own live session
> registry at `~/.claude/sessions/*.json` (sessionId · cwd · pid · live
> `busy`/`idle`), so the extension reads *that* for **active** agents — no hooks
> needed for liveness. `~/.claude/projects/*.jsonl` gives **recent** sessions
> (title = `aiTitle`, pending question = last assistant message), and the optional
> `fleet-register` hook enriches active rows with waiting/done state, task, diff,
> and mode.

## The `→ Claude` primitive
Every dev surface has a one-keystroke "hand it to an agent" action.

## Commands
| Command | Mode | What it does |
|---------|------|--------------|
| **Agents** | list | Active (live) + Recent (history) console. Per agent: **Focus Tab** (jumps to the exact Ghostty tab), Resume, Fork, **Nudge** (type a follow-up into its tab), **Close Tab**, Undo last turn, Stop, Copy resume command, Open in editor/folder. **Detail pane** (⌘I) shows the pending question + mode/state/diff. **Scope** dropdown (All / Active / Recent / per-repo). |
| **My PRs** | list | Cross-repo open PRs with **CI status** (✅/❌/⏳). Per PR: **Review in Claude**, **Check Out & Work** (worktree agent, or opens the existing worktree if the branch is already checked out), **Resume PR agent** (`--from-pr`), open, copy. |
| **Spawn Agent** | form | Repo + task (+optional branch) → worktree agent seeded with the task. |
| **Review PR** | inline | Type a PR number + pick a repo right in the search bar → `claude /review`. |
| **My Issues** | list | Cross-repo open issues → start an agent on one. |
| **Worktrees** | list | Worktrees across repos; open / resume / **remove**; merged branches flagged 🍂. |
| **Claude Code Fleet** | menu bar | Needs-you count badge + roster; click an agent to focus its tab. |

## Focus Tab — how it works
The tab-status hook sets each Ghostty tab's title to `<emoji> <repo>:<branch> — <task>`.
Ghostty exposes tabs as a native `AXTabGroup` of `AXRadioButton`s (titles = those
strings), so the extension matches an agent to its tab by title and `AXPress`es
it. Falls back to raising Ghostty if no match. (Enumeration is retried — System
Events occasionally throws a flaky `-10000`.)

## Preferences (Raycast → Extensions → Claude Code → ⚙️)
- **Agent primary action** — Focus Tab vs Resume (what Enter does on a live agent)
- **Editor command** — `code` / `cursor` / … (for Open in Editor)
- **Repos directory** — override discovery root (else `repos.env` / `~/Repos`)

## Dependencies
Consumes data + tools from
[`claude-mac-tweaks`](https://github.com/vmc-7645/claude-mac-tweaks):
`~/.claude/fleet/` (from `fleet-register.sh`), `~/.config/claude-mac-tweaks/repos.env`,
and the `claude-worktree` / `claude-restore` commands. Also needs
[`gh`](https://cli.github.com), Ghostty, and Claude Code's own
`~/.claude/sessions` + `~/.claude/projects`.

## Setup
1. Install the `claude-mac-tweaks` hooks and **restart Claude Code** so
   `fleet-register` starts enriching active sessions (liveness itself needs no
   hooks). Set your repos root via `claude-repos-refresh` / **Set Repos Directory**.
2. `gh auth login` — for My PRs / My Issues.
3. `cd extension && npm ci && npm run dev` — imports it into Raycast (persists
   after you stop the dev server).
4. **Grant Raycast Accessibility** (System Settings → Privacy & Security →
   Accessibility → enable Raycast) — required for the ⌘T / keystroke / tab-focus
   actions; `gh` reads work without it.

## License
Personal project — all rights reserved unless noted.

# Claude Code for Raycast

A Raycast extension that integrates **Claude Code** into the launcher: see your
dev surfaces (PRs, issues, running agents, past sessions) and **hand any of them
to a Claude agent** — from anywhere, landing in a Ghostty tab. Plus an ambient
menu-bar indicator of who needs you.

> **Status:** spec-complete, verifications done, not yet built. Full design in
> **[SPEC.md](SPEC.md)**.
>
> **Key finding:** Claude Code maintains its own live session registry at
> `~/.claude/sessions/*.json` (sessionId · cwd · pid · live `busy`/`idle` status),
> so the extension reads *that* for active agents — no hooks needed for liveness,
> and no cold-start problem. Hooks become optional enrichment (task label,
> waiting-vs-done, diff). See §6.1.

## The idea — the `→ Claude` primitive
Every dev surface has a one-keystroke "hand it to an agent" action:

| Surface | `→ Claude` |
|---|---|
| a **PR** | Review in Claude / check out & work |
| an **issue** | Start an agent on it |
| a **task** | Spawn an agent (auto-branch) |
| a past **session** | Resume / fork |
| a running **agent** | Jump / resume / inspect |

## Commands (planned)
| Command | Purpose | Priority |
|---------|---------|----------|
| **Agents** | Active (live) + Recent (resumable history) console | MVP |
| **My PRs** | Cross-repo PRs → Review in Claude / checkout | MVP |
| **Spawn Agent** | Task (+branch, repo) → worktree agent | MVP |
| **Review PR** | Repo-aware `PR → Review in Claude` | MVP |
| **Fleet** | Menu-bar count + roster of agents needing you | v1 |
| **Reopen Fleet** | Reopen agents after a reboot/crash | v1 |
| **My Issues** | Issues → start an agent | v1 |
| **Worktrees** | Open / resume / remove worktrees | Later |

## Milestone status
- [x] **M1** — Agents console on Claude's `~/.claude/sessions/` + `projects/` (resume/fork/jump)
- [x] **M2** — My PRs (→ Review in Claude) + Review PR + Spawn Agent
- [x] **M0′** — enriched `fleet-register.sh` (waiting/done state, task, diff, last tool) *(in [claude-mac-tweaks](https://github.com/vmc-7645/claude-mac-tweaks); Agents joins it)*
- [ ] **M3** — Fleet menu bar
- [ ] **M4** — pending-question, diff detail, delete (careful), `--from-pr`, undo, stop, PR CI status
- [ ] **M5** — My Issues, Worktrees, full preferences, GC

## Dependencies
The **collector** (`fleet-register.sh`, enriched at M0) and the shared
**`claude-open-tab`** helper live in
[`claude-mac-tweaks`](https://github.com/vmc-7645/claude-mac-tweaks) — they also
power `fleet-restore` and `worktree-launcher`. This repo *consumes* the
`~/.claude/fleet/` registry + Claude's session history; it does not own the hooks.

Also depends on: `claude-worktree`, `claude-restore` (claude-mac-tweaks),
[`gh`](https://cli.github.com), and Ghostty.

## Setup (once the extension exists)
1. Install & enrich the collector in `claude-mac-tweaks` (M0), then **restart
   Claude Code** so live tracking begins (the registry only fills for sessions
   started after the hooks load).
2. `gh auth login` — for My PRs / My Issues.
3. Grant **Accessibility** to the terminal/Ghostty on first tab-opening action
   (or set `tabOpenMode = window` to avoid it).
4. Set your repos directory (`claude-repos-refresh` / Set Repos Directory), or let
   the extension auto-discover under `~/Repos`.
5. `npm ci && npm run dev` (Raycast `ray develop`) to run the extension locally.

## License
Personal project — all rights reserved unless noted.

# helpers — shell commands + Claude Code hooks

These are the local pieces the Raycast extension drives. The extension is the
UI; these do the work on the machine (open Ghostty tabs, snapshot turns, track
live agent state). They were previously a separate repo (`claude-mac-tweaks`)
and are now vendored here so the extension is self-contained.

**Requirements:** macOS · [Ghostty](https://ghostty.org) · `jq` · `git` · Claude
Code ≥ 2.1.141 (for the `terminalSequence` hook field).

## Install

```sh
helpers/install.sh
```

This copies the commands to `~/.local/bin`, the hooks to `~/.claude/hooks`, and
**auto-merges** the hook wiring into `~/.claude/settings.json` (idempotent; a
timestamped `.bak` is written first, your other hooks/keys are left untouched).
Then restart Claude Code (or run `/hooks`). Pass `--no-merge` to skip the
settings edit and print the block for manual merge instead.

## What's inside

| File | Kind | Extension feature it powers |
|------|------|------------------------------|
| `bin/claude-worktree` | command | **Spawn Agent**, **Check Out & Work** — worktree + new Ghostty tab |
| `bin/claude-undo` | command | **Undo Last Turn** — roll back what the last turn changed |
| `bin/claude-restore` | command | reopen agents after a reboot (companion; run manually) |
| `hooks/tab-status.sh` | hook | **Focus Tab** — sets the `<emoji> <repo>:<branch> — <task>` tab title the extension matches on; plus status emoji + sound |
| `hooks/fleet-register.sh` | hook | **Agents** view enrichment — finer state (working/waiting/done), task label, diff, mode |
| `hooks/checkpoint.sh` | hook | per-turn worktree snapshot that `claude-undo` rolls back to |

The `bin/` commands and `hooks/tab-status.sh` are macOS + Ghostty specific
(AppleScript tab control, `afplay`, `/System/Library/Sounds`). `checkpoint.sh`
and `fleet-register.sh` are terminal-agnostic.

## Degrading gracefully

The extension still works without these — it reads Claude Code's own
`~/.claude/sessions` / `~/.claude/projects` directly, so **liveness needs no
hooks**. Missing the helpers just disables the features in the table above
(Focus Tab falls back to raising Ghostty; Spawn/Undo report the missing
command). Install them to get the full experience.

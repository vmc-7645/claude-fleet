#!/usr/bin/env bash
#
# Set the Ghostty tab title to "<emoji> <cwd-basename>[:<branch>]" so each tab
# shows the status of its Claude agent at a glance, and — only when you are NOT
# already looking at Ghostty — play a macOS system sound. Invoked from Claude
# Code hooks.
#
# Usage (from settings.json hook command):
#   tab-status.sh '<emoji>' ['<sound>']
#     <sound>  name from /System/Library/Sounds (e.g. Blow, Submarine)
#
# Claude Code owns the terminal, so we can't write escape sequences to the tty
# ourselves (hooks have no controlling terminal). Instead we hand Claude Code
# the OSC sequence via the top-level `terminalSequence` hook-output field
# (Claude Code >= 2.1.141) and it emits it for us. Returning JSON also means
# nothing is injected into Claude's context.
set -euo pipefail

emoji="${1:-●}"
sound="${2:-}"

# The hook payload arrives as JSON on stdin; pull the session's cwd from it so
# the title stays meaningful even across /cwd changes. Fall back to $PWD.
input="$(cat)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
cwd="${cwd:-$PWD}"
name="$(basename "$cwd")"

# Task label: on UserPromptSubmit the payload carries `prompt`; stash a short
# version per session so the whole turn's title reads "<repo>:<branch> — <task>".
# Other events (Stop/Notification) reuse the stashed label.
session="$(printf '%s' "$input" | jq -r '.session_id // "default"' 2>/dev/null || echo default)"
prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || true)"
task_file="${TMPDIR:-/tmp}/claude-task-${session}.txt"
label=""
if [ -n "$prompt" ]; then
  # single line, drop control chars, squeeze/trim spaces, cap length
  label="$(printf '%s' "$prompt" | tr '\n\r\t' '   ' | tr -d '\000-\037' \
    | sed -E 's/  +/ /g; s/^ //; s/ $//')"
  [ "${#label}" -gt 40 ] && label="${label:0:40}…"
  printf '%s' "$label" > "$task_file" 2>/dev/null || true
elif [ -f "$task_file" ]; then
  label="$(cat "$task_file" 2>/dev/null || true)"
fi

# Append the git branch when inside a repo so sibling worktrees / feature
# branches of the same repo are distinguishable in the tab bar.
branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
title="$emoji $name"
[ -n "$branch" ] && [ "$branch" != "HEAD" ] && title="$title:$branch"
[ -n "$label" ] && title="$title — $label"

# Attention (sound + Dock bounce) only fires on states that pass a sound, and
# only when you're NOT already looking at Ghostty. The frontmost-app check is a
# ~100ms osascript call, so we run it ONLY when a sound is configured — that
# keeps frequent title re-assertions (e.g. PostToolUse, which fires on every
# tool call to keep the emoji from being overwritten) cheap.
attention=0
if [ -n "$sound" ]; then
  frontmost="$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null || true)"
  case "$(printf '%s' "$frontmost" | tr '[:upper:]' '[:lower:]')" in
    *ghostty*) : ;;  # you're looking at it — stay silent, no bounce
    *)
      sound_file="/System/Library/Sounds/${sound}.aiff"
      [ -f "$sound_file" ] && ( nohup afplay "$sound_file" >/dev/null 2>&1 & )
      attention=1  # ring the bell -> Ghostty bounces the Dock icon
      ;;
  esac
fi

# OSC 2 = set window/tab title.  ESC ] 2 ; <title> BEL
seq="$(printf '\033]2;%s\007' "$title")"
# Append a lone BEL to request attention (Dock bounce) on attention events.
[ "$attention" -eq 1 ] && seq="${seq}$(printf '\a')"

# jq safely JSON-escapes the raw ESC/BEL bytes into  / .
jq -nc --arg seq "$seq" '{terminalSequence: $seq}'

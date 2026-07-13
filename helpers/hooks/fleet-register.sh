#!/usr/bin/env bash
#
# Maintain a DURABLE registry of live Claude agents under ~/.claude/fleet/.
# Powers `claude-restore` (reopen after a reboot) AND enriches the
# claude-code-for-raycast "Agents" view (finer state + task + diff than Claude's
# own busy/idle registry).
#
#   fleet-register.sh touch <state> [reason]   -> upsert (state = working|waiting|done|idle)
#   fleet-register.sh end                       -> remove (SessionEnd)
#
# Wiring: SessionStart->idle, UserPromptSubmit->working, PostToolUse->working,
# Stop->done, Notification(permission)->waiting, Notification(idle)->idle.
#
# macOS bash 3.2 compatible.
set -uo pipefail

action="${1:-touch}"
new_state="${2:-}"
reason_arg="${3:-}"

input="$(cat)"
sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$sid" ] || exit 0

dir="$HOME/.claude/fleet"
f="$dir/${sid}.json"

if [ "$action" = "end" ]; then
  rm -f "$f"
  exit 0
fi

mkdir -p "$dir"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
cwd="${cwd:-$PWD}"
prompt="$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null || true)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)"
tool_target="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.command // empty' 2>/dev/null || true)"
nmsg="$(printf '%s' "$input" | jq -r '.message // empty' 2>/dev/null || true)"
pmode="$(printf '%s' "$input" | jq -r '.permission_mode // empty' 2>/dev/null || true)"

repo=""; branch=""
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  repo="$(basename "$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)")"
  branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
now="$(date +%s)"

# Preserve fields across touches.
started="$now"; task=""; prev_state=""; state_since="$now"; diff=""; last_tool=""; reason_prev=""; mode=""
if [ -f "$f" ]; then
  s="$(jq -r '.started // empty' "$f" 2>/dev/null || true)"; [ -n "$s" ] && started="$s"
  task="$(jq -r '.task // empty' "$f" 2>/dev/null || true)"
  prev_state="$(jq -r '.state // empty' "$f" 2>/dev/null || true)"
  ss="$(jq -r '.state_since // empty' "$f" 2>/dev/null || true)"; [ -n "$ss" ] && state_since="$ss"
  diff="$(jq -r '.diff // empty' "$f" 2>/dev/null || true)"
  last_tool="$(jq -r '.last_tool // empty' "$f" 2>/dev/null || true)"
  reason_prev="$(jq -r '.state_reason // empty' "$f" 2>/dev/null || true)"
  mode="$(jq -r '.mode // empty' "$f" 2>/dev/null || true)"
fi
# Permission mode (default|plan|acceptEdits|bypassPermissions), when the event carries it.
[ -n "$pmode" ] && mode="$pmode"

# Task label from the prompt (UserPromptSubmit).
if [ -n "$prompt" ]; then
  task="$(printf '%s' "$prompt" | tr '\n\r\t' '   ' | tr -d '\000-\037' \
    | sed -E 's/  +/ /g; s/^ //; s/ $//')"
  [ "${#task}" -gt 60 ] && task="${task:0:60}…"
fi

# State + when it changed.
state="${new_state:-$prev_state}"; [ -n "$state" ] || state="idle"
[ "$state" != "$prev_state" ] && state_since="$now"

# Reason (only meaningful while waiting): explicit arg, else the notification msg.
reason_out=""
if [ "$state" = "waiting" ]; then
  if [ -n "$reason_arg" ]; then reason_out="$reason_arg"
  elif [ -n "$nmsg" ]; then reason_out="$nmsg"
  else reason_out="$reason_prev"; fi
fi

# Last tool (PostToolUse carries tool_name). Basename real paths; truncate
# commands (Bash tool_input.command) rather than basename-ing them.
if [ -n "$tool" ]; then
  last_tool="$tool"
  if [ -n "$tool_target" ]; then
    case "$tool_target" in
      */*) last_tool="$tool $(basename "$tool_target")" ;;
      *) t="$tool_target"; [ "${#t}" -gt 30 ] && t="${t:0:30}…"; last_tool="$tool $t" ;;
    esac
  fi
fi

# Diff summary — only on the infrequent done/waiting events (git call is cheap
# but not free; skip it on the high-frequency working touches).
case "$state" in
  done|waiting)
    d="$(git -C "$cwd" diff --shortstat 2>/dev/null | sed -E 's/^ +//')"
    diff="$d"
    ;;
esac

tmp="$(mktemp "${TMPDIR:-/tmp}/fleet.XXXXXX")" || exit 0
if jq -n \
    --arg sid "$sid" --arg cwd "$cwd" --arg repo "$repo" --arg branch "$branch" \
    --arg task "$task" --arg state "$state" --arg reason "$reason_out" \
    --arg diff "$diff" --arg last_tool "$last_tool" --arg mode "$mode" \
    --argjson pid "${PPID:-0}" --argjson started "$started" \
    --argjson state_since "$state_since" --argjson seen "$now" \
    '{session_id:$sid, cwd:$cwd, repo:$repo, branch:$branch, task:$task,
      state:$state, state_reason:$reason, diff:$diff, last_tool:$last_tool,
      mode:$mode, pid:$pid, started:$started, state_since:$state_since, last_seen:$seen}' \
    > "$tmp" 2>/dev/null; then
  mv -f "$tmp" "$f"
else
  rm -f "$tmp"
fi
exit 0

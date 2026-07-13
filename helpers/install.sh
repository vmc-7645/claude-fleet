#!/usr/bin/env bash
#
# Install the shell helpers that Claude Code for Raycast drives:
#
#   PATH commands (-> ~/.local/bin)
#     claude-worktree   worktree + new Ghostty tab   (Spawn / Check Out & Work)
#     claude-undo       roll back the last turn      (Undo Last Turn)
#     claude-restore    reopen agents after a reboot (companion command)
#
#   Claude Code hooks (-> ~/.claude/hooks) + settings.json wiring
#     tab-status.sh     status emoji + tab title      (Focus Tab matching)
#     fleet-register.sh finer agent state / task / diff (Agents view enrichment)
#     checkpoint.sh     per-turn snapshot             (backs claude-undo)
#
# By default this AUTO-MERGES the hook wiring into ~/.claude/settings.json
# (idempotent — safe to re-run; a timestamped backup is made first). Pass
# --no-merge to skip that and print the block for you to merge by hand.
#
# macOS + Ghostty + jq. Idempotent.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="$HOME/.local/bin"
hooks="$HOME/.claude/hooks"
settings="$HOME/.claude/settings.json"
merge=1
[ "${1:-}" = "--no-merge" ] && merge=0

command -v jq >/dev/null 2>&1 || {
  echo "✗ jq is required (the hooks and this installer use it). Install: brew install jq" >&2
  exit 1
}

# 1. PATH commands ------------------------------------------------------------
mkdir -p "$bin"
for c in claude-worktree claude-undo claude-restore; do
  cp "$here/bin/$c" "$bin/$c"
  chmod +x "$bin/$c"
  echo "✓ installed $bin/$c"
done

# 2. Hooks --------------------------------------------------------------------
mkdir -p "$hooks"
for h in tab-status.sh fleet-register.sh checkpoint.sh; do
  cp "$here/hooks/$h" "$hooks/$h"
  chmod +x "$hooks/$h"
  echo "✓ installed $hooks/$h"
done

# 3. zsh branch completion for claude-worktree (optional nicety) --------------
comp_dir="$HOME/.claude/completions"
mkdir -p "$comp_dir"
cp "$here/completions/claude-worktree.zsh" "$comp_dir/claude-worktree.zsh"
echo "✓ installed $comp_dir/claude-worktree.zsh"
src_line='[ -f "$HOME/.claude/completions/claude-worktree.zsh" ] && source "$HOME/.claude/completions/claude-worktree.zsh"'
if [ -f "$HOME/.zshrc" ] && ! grep -qF 'claude-worktree.zsh' "$HOME/.zshrc"; then
  printf '\n# claude-worktree branch completion\n%s\n' "$src_line" >> "$HOME/.zshrc"
  echo "✓ added completion source line to ~/.zshrc"
fi

# 4. Wire the hooks into settings.json ---------------------------------------
if [ "$merge" -eq 1 ]; then
  add="$(jq '.hooks' "$here/hooks.settings.json")"

  cur='{}'
  if [ -f "$settings" ]; then
    if jq -e . "$settings" >/dev/null 2>&1; then
      cp "$settings" "$settings.bak.$(date +%Y%m%d-%H%M%S)"
      cur="$(cat "$settings")"
    else
      echo "✗ $settings is not valid JSON — fix it, or re-run with --no-merge and" >&2
      echo "  merge helpers/hooks.settings.json by hand." >&2
      exit 1
    fi
  fi

  # For each event we manage, drop any prior groups that reference OUR scripts
  # (so re-running never duplicates), then append our fresh groups. Other events
  # and every other settings key are left untouched.
  printf '%s' "$cur" | jq --argjson add "$add" '
    def markers: ["tab-status.sh","checkpoint.sh","fleet-register.sh"];
    def isOurs: (tojson) as $j | any(markers[]; . as $m | ($j | contains($m)));
    .hooks = (.hooks // {})
    | reduce ($add | keys_unsorted[]) as $ev (.;
        .hooks[$ev] = (((.hooks[$ev] // []) | map(select(isOurs | not))) + $add[$ev])
      )
  ' > "$settings.tmp"
  mv -f "$settings.tmp" "$settings"
  echo "✓ merged hook wiring into $settings"
else
  echo
  echo "Merge this \"hooks\" block into $settings (deep-merge into existing events):"
  echo
  cat "$here/hooks.settings.json"
fi

# 5. Post-install notes -------------------------------------------------------
echo
case ":$PATH:" in
  *":$bin:"*) : ;;
  *) echo "⚠  $bin is not on your PATH. Add to ~/.zshrc:"
     echo "     export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
echo "→ Restart Claude Code (or run /hooks) so the new hooks load."
echo "→ First tab-open action will prompt for Accessibility (System Settings →"
echo "   Privacy & Security → Accessibility → enable Ghostty and Raycast)."

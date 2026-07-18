# Claude Fleet Changelog

## [Unreleased]

- Multi-window support: project-affinity window targeting, robust new-window
  (⌘N) fallback, cross-Space Focus Tab, and `Open agents as` / `Tab open delay`
  preferences.
- Commands deliver their command by pasting it (not keystroking), so prompts with
  apostrophes/special characters no longer break the shell.
- **My Issues**, **My PRs**, **PRs to Review**: load the full list (no 50-item
  cap), cache for instant open with background refresh, and add a repo Scope
  dropdown + repo-name search. PR check status is fetched for every PR in one
  batched request.
- **Worktrees**: prune all merged worktrees in one action.
- **Agents**: flag a "stalled" agent (working but not updated for a while);
  honest Focus Tab result; delete acts on the exact transcript path.
- Faster, more reliable tab opening and focus; various correctness fixes.

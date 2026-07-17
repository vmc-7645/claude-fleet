# Claude Fleet — SPEC

**Status:** BUILT — M1–M5 largely shipped and in daily use (see the README for the
live command list). This doc is the design of record; a few items remain deferred
(see §17). **Owner:** Vincent.
**Supersedes:** `fleet-menubar-SPEC.md` (the menu bar is now one command among several).
Gap resolutions from review are integrated below and indexed in Appendix A.

---

## 1. Identity
A Raycast extension that integrates **Claude Code** into the launcher: see your
dev surfaces (PRs, issues, running agents, past sessions) and **hand any of them
to a Claude agent** — from anywhere, landing in a Ghostty tab. Plus an ambient
menu-bar indicator of who needs you.

## 2. First principles — the `→ Claude` primitive
The atomic action: **take a work surface and turn it into a Claude agent,
instantly.** Every list is "things you might hand to Claude"; every item's
primary action is a form of `→ Claude`.

| Surface | `→ Claude` |
|---|---|
| a **PR** | Review in Claude / check out & work |
| an **issue** | Start an agent on it |
| a free-text **task** | Spawn an agent (auto-branch) |
| a **branch** | New worktree agent |
| a past **session** | Resume / fork |
| a running **agent** | Jump to it / resume / inspect |

## 3. Goals / non-goals
**Goals:** launcher-speed spawn/resume/review; one console for active **and**
inactive agents; ambient fleet awareness.
**Non-goals:** notifications (banners/sounds live in `ghostty-tab-status`);
remote control; replacing tab titles; **watching live agent output** (Raycast
can't stream a tab — Detail shows the last state, not a live feed).

## 4. Command set
| Command | Mode | Purpose | Priority |
|---------|------|---------|----------|
| **Agents** | view (List) | Active (live) + Recent (resumable history); resume/fork/jump/inspect | MVP |
| **My PRs** | view (List) | Open PRs (cross-repo) w/ CI+review; **Review in Claude**, checkout, open | MVP |
| **Spawn Agent** | form / args | Task (+optional branch) → auto-worktree agent | MVP |
| **Review PR** | form / arg | Repo-aware `PR → Review in Claude` (repo dropdown or `owner/repo#N`) | MVP |
| **Fleet** | menu-bar | Ambient count + roster of agents needing you | v1 |
| **Reopen Fleet** | no-view | `claude-restore` after reboot/crash | v1 |
| **My Issues** | view (List) | Issues (created/triage) → start an agent | v1 |
| **Worktrees** | view (List) | Existing worktrees → open / resume / remove | Later |

## 5. Commands in detail

### 5.1 Agents (MVP) — the console
One List merging two sources, reconciled per §6.3:
- **Active** — live agents (fleet registry, pid-alive), state 🔔/⚙️/✅/💤,
  triage-sorted (waiting → done → working → idle; longest-waiting first).
- **Recent** — inactive resumable sessions (history on disk), sorted by last-active.

Item: icon (state, or 🕘) · title `repo:branch` or task · subtitle (task /
"N turns") · accessory (state+age / "last active 2h").
Search filters both. **Scope dropdown:** All / Active / Recent / per-repo.
Detail pane (toggle): active → task + diff + last action; recent → title +
first/last message + cwd + turns. (`question` subtitle added post-MVP, §6.1.)

**Actions — active:** ↵ Jump to tab (raise Ghostty, §8) · ⌘R Resume in new tab ·
⌘D Show diff · Open worktree in editor/Finder · Copy branch ·
Stop agent *(best-effort, §5.1.1)* · *(guarded)* Undo last turn (`claude-undo`).
**Actions — recent:** ↵ Resume in new tab (`claude --resume <id>` in its cwd) ·
⌘F Fork session (`--fork-session`) · ⌘P Preview · Reveal cwd · Copy id ·
⌘⌫ Delete *(guarded; gated on §14 verify)*.

**Resume-vs-Jump guard:** if a Recent item is discovered to be **live** (§6.3),
its primary action becomes **Jump**, not Resume — never double-open a session id.

#### 5.1.1 Stopping an agent
Cleanly killing `claude` from outside is unreliable (session→pid is a proxy).
So: primary "stop" = **Jump to tab** (you Ctrl-C there). An optional best-effort
**Stop** action sends `SIGINT` to the registry's recorded `pid` behind a
confirmation; **not in MVP**, and clearly labeled best-effort.

### 5.2 My PRs (MVP)
Cross-repo list (§7) via `gh search prs --author=@me --state=open` (falls back to
per-configured-repo `gh pr list --repo`). Fields: CI rollup, review decision,
draft/conflict. Sections: Needs me / Ready / Waiting / Drafts.
**Actions:** ↵ **Review in Claude** (open tab: `claude "/review <n>"` in the PR's
repo) · **Resume PR agent** if one exists (`claude --from-pr <n>`, or resume the
matching worktree session — §5.2.1) · Check out & work (`gh pr checkout` into a
worktree + agent) · Open in browser · Copy branch · View checks.

#### 5.2.1 PR ↔ session linkage
Prefer resuming an existing agent over starting fresh: if `--from-pr <n>`
resolves a linked session, or a worktree/branch for the PR already has history,
offer **Resume PR agent**; else **Review in Claude** (fresh). (`--from-pr`
behavior to confirm — §14.)

### 5.3 Spawn Agent (MVP)
Form: **repo Dropdown** (§7, pre-selected to resolved default, searchable) +
**task** (required) + **branch** (optional, else `agent/<slug>`). Wraps
`claude-worktree` + `CLAUDE_WT_PROMPT`; remembers the repo as last-used.

### 5.4 Review PR (MVP)
Two entry points, both repo-aware (§7):
- **Form** (quick pick): repo **Dropdown** (pre-selected to resolved default,
  searchable) + PR number field — pick a repo in a keystroke.
- **Argument** (fast path): `owner/repo#N` / `repo#N` explicit, or bare `N` →
  resolved default repo (§7.1).
Opens a tab: `claude "/review <n>"` in the chosen repo; remembers it as last-used.
(Note: bare `N` was previously repo-blind — this resolves that.)

### 5.5 Fleet (v1) — ambient menu bar
`MenuBarExtra`: icon + needs-you count (`🔔 2`, icon-only when 0), dropdown
grouped Needs-you / Working / Idle; per-agent resume/raise/diff. Same registry +
ranking as **Agents**.

### 5.6 Reopen Fleet (v1)
No-view → `claude-restore --yes`.

### 5.7 My Issues (v1)
Cross-repo (§7). Actions: open · **Start agent on this issue** (spawn seeded with
issue title/body).

### 5.8 Worktrees (Later)
List worktrees under `<repo>-worktrees/`. Actions: open · resume the worktree's
session · **remove** (merged / gone-branch cleanup).

## 6. Data sources & contracts

### 6.1 ACTIVE agents — Claude's own session registry (PRIMARY)
Claude Code maintains **`~/.claude/sessions/<pid>.json`** for every LIVE session
and deletes it when the process exits (**verified: file count == live `claude`
process count**). Fields: `sessionId, cwd, pid, status ("busy"|"idle"), name,
kind, entrypoint, startedAt, updatedAt`. `status` is **live** (busy = working,
idle = your turn / idle). This is the **authoritative source of which agents are
live** — no hooks required, self-cleaning, and it includes sessions started
before any hook, so the **cold-start gap is gone**.

#### 6.1a Optional enrichment — the fleet hook
`~/.claude/fleet/<session_id>.json` (from `fleet-register.sh`) adds what Claude's
registry lacks, joined by `sessionId`: finer state (`waiting`-on-permission /
`done`, beyond busy/idle), the **task** label, `state_since`, `diff`, `last_tool`,
and (post-MVP) `question`. Where absent (e.g. cold start), the UI falls back to
Claude's `status`. **The hook is a refinement, not a prerequisite** — M1 ships on
Claude's registry alone. Enrichment fields:
| Field | Meaning | Written by | Phase |
|-------|---------|-----------|-------|
| `state` | working/waiting/idle/done | every event | **MVP** |
| `state_since` | epoch of current state | on state change | **MVP** |
| `state_reason` | permission tool for `waiting` | Notification(permission) | **MVP** |
| `diff` | `git diff --shortstat` (cheap) | Stop, Notification | **MVP** |
| `last_tool` | last tool+target while working | PostToolUse | **MVP** |
| `question` | last assistant message (~200c) | Stop, Notification | **post-MVP** |

`question` requires parsing `transcript_path` in bash — the fragile/risky part —
so it is **deferred off the critical path**. Absent → subtitle degrades to
`last_tool`/task. Atomic writes; bash 3.2. Reader tolerates missing fields.

### 6.2 Session history — INACTIVE agents
`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`, one file per session.
- **session id** = filename; **cwd** read from *inside* the transcript (never
  reverse the dir name — dashes are ambiguous, e.g. `myrepo-worktrees`).
- **title** = the last `ai-title` entry's **`aiTitle`** field in the transcript (a
  Claude-generated title — verified present; filter by matching `sessionId` when a
  transcript has several), else the first user message. **last active** = mtime;
  **turns** = line count.
- Read only the file **head** for the title; see caching §9.
- No machine-readable `claude sessions` list exists → enumerate files.
- Non-git sessions (e.g. `~`): `repo`/`branch` empty — render by cwd basename.

### 6.3 Active/inactive reconciliation (simplified by §6.1)
- **Active** = the sessions in **`~/.claude/sessions/*.json`** (authoritative,
  live, self-cleaning). `status` → working (busy) / your-turn (idle); refine with
  the fleet hook (waiting / done + task / diff) by `sessionId` when present.
- **Recent** = transcripts in `~/.claude/projects/*.jsonl` whose `sessionId` is
  **not** in the Active set.
- **Dedup** by `sessionId`. No pid/boot/grace heuristics and **no cold-start
  warming** — Claude's own registry handles liveness and covers pre-hook sessions.

### 6.4 GitHub — `gh`
Cross-repo reads via `gh search prs/issues --author=@me`; per-repo detail via
`gh pr list/status/checks --repo`, `gh pr checkout`. gh auth is via keychain/config
(independent of PATH). Show loading state; cache short-lived results.

## 7. Repo resolution & picker
The extension has **no cwd**, so every repo-scoped command (Review PR, Spawn, My
PRs, My Issues) must both **auto-pick a sensible repo** and let you **switch fast**.

### 7.1 Resolution order (single-repo actions)
1. **Explicit** — chosen in the command's repo dropdown, or `owner/repo#N` / `repo#N` syntax in an argument.
2. **Last-used** — the repo you last acted on (persisted in LocalStorage per command family).
3. **`defaultRepo`** preference.
4. **Auto-detected** — the **most recently active repo**: newest session mtime in
   `~/.claude/projects`, or newest fleet entry. ← the "auto" default.

The resolved repo is what the picker is **pre-selected** to, so the common case is
zero-friction and any override is one keystroke.

### 7.2 Repo sources ("what you have access to")
- **Local** — git repos under the `repos` roots (default `~/Repos/*`): the ones
  you actually work in. Fast, offline, recency-sorted.
- **GitHub** — `gh repo list --limit 200 --json nameWithOwner` (+ orgs you belong
  to): repos you can access but may not have cloned — for reviewing a PR in an
  un-cloned repo. Cached; lazy "search all GitHub repos" fallback.
The picker shows **Local first** (recency-sorted), then a GitHub search fallback.
Reviewing a PR in an un-cloned repo → offer to `gh repo clone` (or `gh pr checkout`
into a temp worktree) before opening the agent.

### 7.3 Quick pick UX
- **Single-repo commands** (Review PR, Spawn) use a **searchable repo Dropdown**
  pre-selected to the resolved default (§7.1) — type-to-filter, instant override.
- **List commands** (My PRs, My Issues) default to a **cross-repo** view
  (`gh search prs/issues --author=@me`) with the scope dropdown to narrow to one
  repo. So browsing is inherently repo-correct (each row carries its repo).
See preference schema in §12.

## 8. `→ Claude` actions & open-a-tab robustness
All spawn/resume/review actions open a Ghostty tab running a command. This is
centralized in the extension's Ghostty layer (`extension/src/lib/ghostty.ts`,
`openGhosttyTab`); `helpers/bin/claude-worktree` uses the same ⌘T + typed-command
recipe for the shell path. Steps:
1. **Choose the window (project affinity):** enumerate Ghostty's windows/tabs and
   bias HARD against a fresh window (`chooseTargetWindow`): open into a window that
   already hosts the same project (matched off `<repo>` in its tab titles), else
   the frontmost / most-recently-used window. Raise that window (AXMain + AXRaise;
   Dock-press to switch Spaces for a fullscreen or background target) so the ⌘T
   lands in it. Only when there are **no** windows do we open a new one.
2. **New tab:** send ⌘T (Ghostty `new_tab`).
3. **Wait for shell readiness:** delay = pref `tabOpenDelay` (default 0.7s). Too
   short under load and the keystrokes are dropped and the agent never starts —
   the "tab opens in the right folder but claude doesn't run" bug.
4. **Type + Return:** `cd <dir> && <cmd>`.
5. **New-window path (`tabOpenMode = window`, or no window to reuse):** send ⌘N
   (Ghostty `new_window`), then type as in 3–4. NOTE: on macOS a running Ghostty
   is single-instance, so `open -na Ghostty.app --args -e '<cmd>'` is dropped (the
   window opens but the command never runs) — ⌘N is the only reliable new-window
   mechanism. `open -a Ghostty.app` is used only to cold-launch Ghostty when it
   isn't running (its initial window is then the target — no ⌘N needed).
- **Resume:** `claude --resume <id>` from cwd. **Fork:** `--fork-session`.
  **Review:** `claude "/review <n>"`. **Raise:** `osascript … activate`.
- Requires Accessibility (already granted).

## 9. History performance & caching
- Enumerate `~/.claude/projects/*/*.jsonl`; sort by mtime.
- **Title cache** in Raycast `LocalStorage` (or `~/.cache/claude-fleet/titles.json`)
  keyed by `session_id:mtime`; re-read the head only when mtime changes.
- Lazy-load titles for off-screen rows; cap initial parse to the newest ~N, load
  more on scroll/search. Never full-parse a transcript for the list.

## 10. Architecture
```
collect (hooks)           store                          render (Raycast ext)
fleet-register.sh  ─▶ ~/.claude/fleet/*.json  ─┐
Claude sessions   ─▶ ~/.claude/projects/…      ├▶ List / MenuBarExtra / Detail
gh ───────────────▶ GitHub                     ┘   + actions → claude-open-tab /
                                                     claude --resume / gh / claude-worktree
```

## 11. Liveness / GC
Claude Code maintains `~/.claude/sessions/` itself (deletes files on exit), so
**active liveness/GC is free**. Only the optional fleet-hook files
(`~/.claude/fleet/`) can go stale — prune those whose `sessionId` is no longer in
`sessions/` or `projects/`.

## 12. Preferences (schema)
| Pref | Type | Default | Used by |
|------|------|---------|---------|
| `repos` | paths | auto (`~/Repos/*` git repos) | repo picker (§7) |
| `defaultRepo` | path/name | — (else auto-detect, §7.1) | resolution order |
| `includeGitHubRepos` | bool | `true` | picker GitHub fallback (`gh repo list`) |
| _(last-used repo)_ | — | persisted, not a pref | resolution order §7.1 |
| `editorCommand` | string | `code` (or `$EDITOR`) | Open-in-editor |
| `primaryClick` | enum(raise,resume) | `raise` | Agents/Fleet |
| `tabOpenMode` | enum(tab,window) | `tab` | open-a-tab |
| `tabOpenDelay` | number(s) | `0.7` | open-a-tab |
| `pollInterval` | enum (Raycast-allowed) | lowest | Fleet menu bar |
| `recentLimit` | number | `0` (all) | Agents/Recent |
| `badgeMetric` | enum(needsYou,total) | `needsYou` | Fleet |
| `hideBadgeWhenZero` | bool | `false` (icon-only) | Fleet |

## 13. Empty & error states (cross-cutting)
Every command handles: **gh not authed** → row/CTA "Run `gh auth login`";
**no active sessions** → "No live agents" + show Recent;
**no worktrees / no PRs / no issues** → friendly empty + a spawn CTA;
**Ghostty not running** → open-a-tab launches it (§8). Errors surface as a Raycast
toast, never a silent no-op.

## 14. Tech stack, distribution & layout
- TypeScript + React, `@raycast/api` (`List`, `MenuBarExtra`, `Detail`, `Form`,
  `Action`). Node + `ray` CLI.
- **Distribution (no store):** develop with `npm run dev` (`ray develop`); a
  locally-imported dev extension **persists in Raycast after the dev server stops**
  (it stays listed and runnable). Updates require re-running dev/build.
  *(Persistence-after-stop to confirm — §16.)*
- Actions via `child_process` / `runAppleScript`, or by shelling to
  `claude-open-tab` / `claude-worktree` / `claude-restore`.
```
extension/
  package.json      # commands: agents(view) my-prs(view) spawn(form)
                    #           review-pr(form) fleet(menu-bar) reopen(no-view)
  src/agents.tsx    src/my-prs.tsx  src/spawn.tsx  src/review-pr.tsx
  src/fleet-menu-bar.tsx
  src/lib/{registry,history,gh,rank,claude,cache}.ts
  assets/icon.png
```

## 15. Repo & collector location
New repo **`claude-fleet`**: `SPEC.md` + `extension/`. The
enriched `fleet-register.sh` and the shared `claude-open-tab` helper live in
**`claude-mac-tweaks`** (single source; also power `fleet-restore`/`worktree-launcher`);
this repo consumes them.

## 16. Verifications — RESOLVED
1. **`MenuBarExtra`** — `title` prop shows text/count (pseudo-badge) ✓; return
   `null` to hide the item ✓; re-renders on open ✓; background `interval` in
   package.json (exact min ~1m, non-blocking since fresh-on-open). ✓
2. **`--resume <id>` gone cwd** — non-blocking: Active cwd comes from Claude's
   registry (exists); Recent cwd from the transcript; fallback = repo root / warn. ✓
3. **Delete safety** — CONFIRMED ancillary state exists (`~/.claude/sessions`,
   `session-env`, `file-history`, `history.jsonl`), so bare `rm` of a transcript is
   unsafe → **Delete stays deferred / careful** (M4). ✓
4. **Title source** — RESOLVED: transcripts carry `ai-title` entries with
   **`aiTitle`** (Claude-generated). Use the last matching one; fallback first user
   message. ✓
5. **`--from-pr`** — CONFIRMED: "Resume a session linked to a PR by PR
   number/URL" → viable for "Resume PR agent". ✓
6. **Dev-extension persistence** — local dev extensions persist in Raycast after
   the dev server stops (updates need a re-run). ✓

## 17. Milestones (status)
- [x] **M1** — **Agents** console on `~/.claude/sessions/` + `~/.claude/projects/`;
  Resume / Fork / **Focus Tab** (title-match + AXPress, with retry).
- [x] **M2** — **My PRs** (cross-repo `gh search`) + **Review in Claude**;
  **Review PR** (inline no-view args); **Spawn Agent**.
- [x] **M0′** (in `claude-mac-tweaks`) — enriched `fleet-register.sh`
  (`state` waiting/done, `task`, `diff`, `last_tool`, `mode`); Agents joins it.
- [x] **M3** — **Fleet** menu bar (needs-you badge + roster).
- [x] **M4** (most) — agent **mode** accessory; **Check Out & Work** (handles a
  branch already checked out → opens in that worktree) + **Resume PR agent**
  (`--from-pr`); **pending-question** in Detail (transcript read in TS); **PR CI
  status**; Undo; **Stop** (SIGINT); **Nudge**, **Close Tab**, Copy resume cmd.
  *(Deferred: Delete session — ancillary state, §16.3; PR diff inline; approve/merge.)*
- [x] **M5** (most) — **My Issues**; **Worktrees** (open/resume/remove, **merged
  🍂 flag**); **Preferences** (primary-click, editor, repos root); clean-up-stale GC;
  scope filter. *(Deferred: dynamic Review-PR repo dropdown — it's static in the manifest.)*

### Not implemented / notes
- The shared `claude-open-tab` helper wasn't extracted — the extension opens tabs
  itself via `runAppleScript` (AppleScript in `claude.ts`).
- Key runtime fixes (see git log): `closeMainWindow()` before driving Ghostty;
  avoid the `tab` keyword inside `tell process` (→ -10000); retry tab enumeration.

## 18. Decisions (resolved defaults)
1. Badge = **needs-you count**. 2. Zero → **icon-only**. 3. Primary click =
**raise Ghostty**. 4. Scope = **cross-repo default**, dropdown to filter.
5. Refresh = **lowest allowed + fresh-on-open**. 6. Collector home =
**`claude-mac-tweaks`**. 7. Recent cap = **all** (cached/lazy). *(Override via prefs.)*

## 19. Deprecation & shell parity
The `raycast-commands` shell scripts are the **v0** of this tool and already
approximate parts of the spec: repo-aware commands with a repo **dropdown** and a
**configurable repos directory** — `~/.config/claude-mac-tweaks/repos.env`
(`REPO_ROOT` + `DEFAULT_REPO`), set via the **Set Repos Directory** command or the
`claude-repos-refresh [dir]` CLI, which also regenerates the dropdowns. This
matches §7's `repos` roots **minus dynamic discovery** (script-command dropdowns
are static, so they need the explicit refresh; the extension will auto-discover
local repos + include un-cloned GitHub repos, §7.2).

Once the extension ships, the shell scripts (spawn, quick, review, my-prs, reopen,
set-repos-dir) are **superseded** by the richer browse-then-act commands. Keep them
working until then; then mark that tweak deprecated (or thin it to a pointer). The
`repos.env` config can carry over as one input to §7.1's resolution.

## 20. Testing
- **Collector:** feed simulated hook payloads; assert JSON. **History:** fixture
  project dirs/jsonl; assert title/cwd/turns + cache invalidation.
- **Reconciliation:** fixtures for live/dead/both-sources/cold-start; assert
  Active/Recent classification + dedup.
- **Extension:** `ray develop` against seeded `~/.claude/{fleet,projects}`.
- **Actions:** dry-run `claude-open-tab` (echo instead of type); Ghostty-not-running path.

---

### Appendix A — gap traceability (where each reviewed gap is resolved)
1 Active under-defined → §6.1/§6.3, §5.1 (Resume-vs-Jump). 2 Cold-start → RESOLVED by Claude's `sessions/` registry (§6.1/§6.3).
3 Cross-repo → §7, §5.2/5.4. 4 Stop/kill → §5.1.1. 5 Open-a-tab fragile → §8.
6 Collector risk → §6.1 (question post-MVP), §17-M0. 7 History perf → §9.
8 Delete safety → §16.3, §5.1 (gated). 9 Title source → §16.4, §6.2.
10 Resume gone-cwd → §16.2, §8. 11 Distribution → §14. 12 `--from-pr` → §5.2.1.
13 Empty/error states → §13. 14 Preferences + deprecation → §12, §19.

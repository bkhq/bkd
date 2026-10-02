# BKD - Changelog

Change history for tasks, plans, and decisions. Entries are appended newest-last.

Entry format:

```markdown
## YYYY-MM-DD HH:MM [tag]

[content]
```

Tags: `[progress]`, `[BUG-P0]`, `[BUG-P1]`, `[pitfall]`, `[decision]`.

---

## 2026-09-10 02:10 [decision]

Realigned `docs/task/` and `docs/plan/` with the current PMA formats.

- Both index files documented the retired `PREFIX-NNN` / `PLAN-NNN` ID scheme and the
  "only update the checkbox marker; never delete the line" rule. Usage, Format, and Rules
  now follow the canonical templates: IDs are `<timestamp>-<feature-slug>` (UTC minute
  precision, no sequence numbers), entries may be revised or deleted, and change history
  is recorded here.
- Existing `PREFIX-NNN` / `PLAN-NNN` files keep their names — the format reference declares
  numbered files still valid and forbids renaming them without an explicit request.
- `AUDIT-001` and `PLAN-021` entries had been inserted above the Usage section of their
  index; both were moved into the `## Tasks` / `## Plans` lists.
- Detail-file metadata normalized to the allowed field/value sets, with the reasons moved
  into `Notes` / `Annotations`:
  - Plans: `PLAN-001`, `PLAN-002` (`implementing` -> `rejected`), `PLAN-003`, `PLAN-004`
    (free-text status -> `rejected`), `PLAN-011` (added `approvedAt`, `relatedTask`),
    `PLAN-012`, `PLAN-013`, `PLAN-021` (`task` -> `relatedTask`, added `approvedAt` /
    `createdAt`).
  - Tasks: `WB-001`..`WB-004` (`in_progress` / `completed` -> `closed`, matching the `[~]`
    markers left after the whiteboard removal), `ENG-001`, `ENG-002` (free-text status ->
    `closed`).
- Added this file; `docs/changelog.md` is a required PMA artifact and is referenced by both
  index files.
- Replaced the restated PMA rules in `AGENTS.md` / `CLAUDE.md` *Project Development* with a
  pointer to `/pma` plus the project-specific facts, per the project-injection reference.

---

## 2026-09-10 05:53 [BUG-P1]

Converged every `data/`-relative path on a single `DATA_DIR`
(`20260910-0528-uploads-root-dir` / `20260910-0533-uploads-root-dir`).

- `UPLOAD_DIR` was `resolve(process.cwd(), 'data/uploads')` — the only persistent path
  derived from the cwd. lode runs BKD from `<dir>/versions/<version>/`, so attachments were
  written into the per-version directory: after an upgrade they resolved against the new
  version dir (`404 Attachment file missing`), and pruning the old version dir deleted them.
  The same split was already visible in dev — `data/db` and `data/logs` in the repo root,
  251 attachment files under `apps/api/data/uploads`.
- `BKD_DATA_DIR` is the documented override for the data directory
  (`docs/deployment.md`, successor to the launcher's `--data-dir`), but only `pid-lock.ts`
  implemented it. `root.ts` now exports `resolveDataDir(env)` / `DATA_DIR`
  (`BKD_DATA_DIR` ?? `<ROOT_DIR>/data`), and uploads, the app log, issue debug logs, the
  cleanup route, the PID lock and the default DB path all hang off it.
- A relative `DB_PATH` deliberately keeps its `ROOT_DIR` base — `.env.example` ships
  `DB_PATH=data/db/bkd.db`, which would otherwise become `<DATA_DIR>/data/db/bkd.db`.
  Only the default moved to `DATA_DIR`.
- `GET .../attachments/:id` now resolves `storedName` inside `UPLOAD_DIR` and falls back to
  the pre-change cwd location when the primary file is absent, so attachments written before
  this change stay readable. Both branches keep the SEC-025 containment check, and the
  resolution no longer trusts the DB's `storagePath` string.
- `upload-cleanup` imports `UPLOAD_DIR` instead of recomputing it, so the base cannot drift
  again. It intentionally does not prune the legacy directory.
- `BKD_DATA_DIR` documented in both `.env.example` files.
- Dev checkout: the 251 files under `apps/api/data/uploads` were moved into `data/uploads`
  (no name collisions) and the empty `apps/api/data` tree removed.
- Verified: `bun run lint`, `bun run typecheck`, `bun run test:api` (676 pass),
  `bun run test:frontend` (96 pass), `bun run build`.

---

## 2026-09-10 06:14 [BUG-P1]

Follow-up to the `DATA_DIR` convergence: `DB_PATH` now resolves from `DATA_DIR` too
(`20260910-0528-uploads-root-dir`).

- The first pass kept a relative `DB_PATH` anchored at `ROOT_DIR` to protect the shipped
  `DB_PATH=data/db/bkd.db` example. That preserved exactly the kind of exception the task
  set out to remove, leaving `DATA_DIR` as "the single source, except for the database".
- `resolveDbPath()` now treats `DATA_DIR` as the only base: absolute `DB_PATH` verbatim,
  relative resolved inside `DATA_DIR`, default `<DATA_DIR>/db/bkd.db`. With `BKD_DATA_DIR`
  unset the default is byte-identical to the old `<ROOT_DIR>/data/db/bkd.db`.
- Compatibility: a relative `DB_PATH` changes meaning (`data/db/bkd.db` was
  `<ROOT_DIR>/data/db/bkd.db`, now `<DATA_DIR>/data/db/bkd.db`). When the new location holds
  no database but the old one does, the old file is used — an empty database created beside a
  populated one is indistinguishable from data loss. `docs/bkd.lode.toml` already suggests an
  absolute path and is unaffected.
- `pid-lock.ts` and `db/reset.ts` each carried their own copy of the old parsing rule; both
  now call `resolveDbPath()`, so there is a single implementation.
- Shipped examples moved to the `DATA_DIR`-relative form (`DB_PATH=db/bkd.db`) in both
  `.env.example` files; `docs/development.md` gained a `BKD_DATA_DIR` row and the corrected
  `DB_PATH` default; the stale "ROOT_DIR-relative defaults" comment in
  `scripts/migrate-to-lode.ts` was fixed.
- Verified: `bun run lint`, `bun run typecheck`, `bun run test:api` (677 pass),
  `bun run test:frontend` (96 pass), `bun run build`.

---

## 2026-09-10 07:26 [decision]

Dropped Claude Fable 5 from the `claude-code` model catalog, keeping only 5.1
(`20260910-0724-drop-fable-5`).

- `CLAUDE_MODELS` no longer lists `claude-fable-5` / `claude-fable-5[1m]`; the 5.1 pair and
  the Opus/Sonnet entries are unchanged.
- This reverses the reason 86f9d78 kept Fable 5 listed. `pickExecutionModel` keeps a pinned
  selection only while it exists in the catalog, so an issue pinned to `claude-fable-5` now
  resolves to the catalog default (`claude-opus-5`) on its next execution rather than staying
  on Fable 5. Requested with that behaviour understood; no data migration — the stored
  `model` value is simply no longer matched.
- Verified: `bun run lint` (0 errors), `bun run typecheck`, `bun run test:api`
  (677 pass), `bun run test:frontend` (96 pass), `bun run build`.

---

## 2026-09-12 19:55 [progress]

Projects can carry free-form tags, and the dashboard filters by them
(`20260912-1920-project-tags`).

- `projects.tags` is a single TEXT column holding a JSON array (migration `0024`), the same
  denormalized shape `issues.tag` already uses. No tag table, no registry, no per-tag
  colour or rename — a normalized `tags` + `project_tags` pair was rejected as unjustified
  at a scale where the whole project list ships in one response.
- `parseTags` / `serializeTags` moved from `routes/issues/_shared.ts` to `utils/tags.ts` so
  the projects route does not have to import from the issues route. `normalizeTags` is new:
  it trims, collapses internal whitespace, and drops case-insensitive duplicates keeping
  first-seen casing, so `web` / `Web` / `web ` cannot become three tags. Both project write
  handlers call it, so create and update cannot diverge.
- Contract: `tags` on `Project`, `CreateProject`, and `UpdateProject`; at most 20 tags of at
  most 50 chars each. `null` and `[]` both clear the set; omitting the field leaves it
  untouched. Purely additive — existing clients and the `bkd` skill are unaffected.
- Dashboard: a chip row above the grid (`All` + one chip per tag, single-select, not
  persisted) narrows the active project list; tags render as badges on each card. The
  archived section is untouched.
- Drag reordering is disabled while a filter is active. `HomePage` derives the fractional
  sort key from the *rendered* neighbours, so a drop inside a filtered subset would have
  silently reordered against an unrelated project.
- Verified: `bun run lint` (0 errors, 2 pre-existing warnings), `bun run typecheck`,
  `bun run test:api` (684 pass, 1 fail), `bun run test:frontend` (99 pass),
  `bun run build`, and `bun run db:generate` reporting no further changes. The single API
  failure is `api-execution > async execution transitions to running then completed`, a
  pre-existing 5s-timeout flake under full-suite load — reproduced identically on a clean
  `HEAD` worktree (676 pass, 1 fail) and passing in isolation.

---

## 2026-09-13 00:42 [BUG-P1]

Fixed message-list overlap and streaming scroll instability
(`20260912-2116-message-list-rendering` / `20260912-2124-message-list-rendering`).

- Align virtual measurements with message IDs and preserve the visible anchor across history insertion, live-window trimming, and the 80-row layout threshold.
- Follow streaming and delayed height changes without restarting smooth-scroll animations; preserve deliberate upward scrolling and reset state for a new conversation.
- Skip unchanged conversation-row renders and repeated HTML sanitization. In the browser sample, 30 updates dropped from 1,818 sanitizations to 30 while retaining tool, command-output, task-plan, and duration updates.
- Added 17 regression cases. All 116 frontend tests, repository lint (two existing warnings), API/frontend typecheck, and containerized frontend build passed. Browser history, width-change, expansion/collapse, and streaming checks passed.
- `bun run check` retains the previously documented API-suite failure: `async execution transitions to running then completed` / `waitFor timed out after 5000ms` (684 pass, 1 skip, 1 fail, 1 error). The test passed in isolation in the same container; backend code is unchanged.

---

## 2026-09-13 00:40 [progress]

Replaced the create-issue status dropdown with a switch
(`20260913-0023-create-issue-status-toggle`).

- Creation only ever produced two outcomes — queue (`todo`) or create and execute
  (`working`, which the server also derives from `review`) — so the four-status dropdown
  offered choices that collapsed server-side. The status property row now uses the same
  `Switch` control as the worktree row, with the status dot and name beside it.
- `initialStatusId` from a board column is folded onto the two states: `working` and
  `review` preselect on, everything else (including the `done` column's `+` button)
  preselects off, so creating from the `done` column now queues a `todo` issue instead of
  a pre-completed one.
- No new i18n keys: the label reuses `statusName.Todo` / `statusName.Working`.
- Added 4 regression cases (`create-issue-status.test.tsx`). `bun run check`: lint 0 errors
  (2 pre-existing warnings), typecheck clean, 120 frontend tests pass; the API suite keeps
  the documented `async execution transitions to running then completed` timeout flake
  (684 pass, 1 fail), which passes in isolation and touches no changed code.

---

## 2026-09-16 05:25 [BUG-P1]

Centered the sidebar rail on the active project
(`20260916-0520-sidebar-active-project-scroll`).

- `AppSidebar` renders projects in a scroll container with a hidden scrollbar, and never
  scrolled the active entry into view. With enough projects the selection highlight sat
  outside the visible range, so nothing on screen told the user which project was open —
  the list view made it obvious because the rail is the only project indicator there.
- `ProjectButton` now calls `scrollIntoView({ block: 'center' })` when it becomes active,
  which covers both mount and a project switch. Pages that pass an empty
  `activeProjectId` (the review page) still do not scroll.
- The page shells are `h-full` with no scrolling ancestor, so centering moves the rail only.
- `MobileSidebar` has the same pattern in its drawer list; left untouched, not reported.
- Added 3 regression cases (`app-sidebar.test.tsx`). `bun run check`: lint 0 errors
  (2 pre-existing warnings), typecheck clean, 123 frontend tests pass; the API suite keeps
  the documented `async execution transitions to running then completed` timeout flake
  (684 pass, 1 fail), which passes in isolation and touches no changed code.

## 2026-09-22 17:12 [progress]

20260922-1703-mobile-desktop-ui-parity / 20260922-1704: aligned mobile and desktop UI
and finished the BKD rename.

- Global page links (Review, Cron, Local sessions) now come from one list,
  `lib/global-pages.ts`, rendered by the desktop rail, the mobile sheet and both
  home-page menus. The mobile sheet header shows the configured server name
  (fallback `BKD`) and the SSE connection indicator. `/cron` and `/sessions` render
  the desktop rail and the mobile menu trigger like `/review`.
- Create-issue dialog is full-screen and scrollable below `md`. Dialog width
  overrides use the `sm:` prefix so the base `sm:max-w-sm` no longer wins between
  640 and 767px (`CreateIssueDialog`, `SettingsLayout`, `FilePreviewModal`,
  `DirectoryPicker`, `CreateProjectDialog`, local-sessions import dialog).
- Mobile touch targets: list-panel and kanban header buttons are 36px below `md`;
  search, tag, description and title-edit inputs use 16px text below `md`.
- Branding: `AppLogo` alt, `manifest.json`, package descriptions and the bundle
  defines (`__BITK_*` -> `__BKD_*`) now say BKD. Favicon glyph stays `BK`.
- Discovered and filed separately: 20260922-1712-api-execution-suite-order-flake.

## 2026-09-24 08:05 [progress]

20260923-1133-grok-engine: added Grok Build (`grok`) as a third engine type.

- `executors/grok/`: headless executor (`-p ... --output-format streaming-messages-json
  --permission-mode bypassPermissions`, `-s` for a new session, `-r` to resume, SIGTERM
  to cancel) and a self-contained normalizer that maps Grok's tool set and decodes its
  typed JSON tool results. Availability and models come from `grok --version` and
  `grok models`.
- `'grok'` wired into `EngineType`, built-in profiles, the executor registry, slash-command
  cache, virtual-engine reserved ids, settings validation, and safe-env (`XAI_API_KEY`,
  `GROK_HOME`). The context-usage pipeline stage now also runs for grok.
- `register.ts`: the stdout-pipe-broke diagnostic is skipped after an interrupt — grok
  closes stdout before exiting on SIGTERM, which is shutdown, not breakage.
- Out of scope: local session browser/import, virtual engines based on grok, slash-command
  discovery, usage panel, mid-turn messages, interactive permission approval.
- Verified end to end on grok 1.0.41 against an isolated API instance: execute, follow-up
  with context, cancel mid-command, resume after cancel; token/cost and context window
  recorded.

## 2026-09-24 10:05 [progress]

20260924-0914-cursor-engine: added Cursor CLI (`cursor`) as a fourth engine type.

- `executors/cursor/`: headless executor (`cursor-agent -p --output-format stream-json
  --force --trust --workspace <dir> --resume <id> [--model <m>] <prompt>`, SIGTERM to
  cancel) and a self-contained normalizer for the `system/init`, `thinking` delta,
  `assistant`, `tool_call` (`<name>ToolCall.{args,result}`) and `result` events.
  Token usage comes from `result.usage` (input + cache read + cache write).
- `--resume <uuid>` creates the session when the id is unknown, so BKD's pre-generated
  `externalSessionId` is passed on the first turn; no `create-chat` round-trip.
- Only `cursor-agent` is resolved (PATH, then `~/.local/bin`): the primary `agent` name
  collides with grok's alias, and every Cursor run rewrites `~/.local/bin/agent` to
  point at itself.
- `'cursor'` wired into `EngineType`, built-in profiles, the executor registry,
  slash-command cache, virtual-engine reserved ids, settings validation and safe-env
  (`CURSOR_API_KEY`). Frontend gets an engine icon.
- Pitfall: the CLI blocks when stdin is an inherited pipe (`create-chat` hung for
  minutes); every subprocess uses `stdin: 'ignore'`.
- Out of scope: partial-output streaming, local session browser/import, virtual
  engines based on cursor, slash-command discovery, MCP approval, plan mode.
- Verified end to end on cursor-agent 2026.09.23-86fc751 against an isolated API
  instance: probe (installed + authenticated, 241 models), execute, follow-up with
  context, cancel mid-command (SIGTERM, exit 143, session kept), follow-up after cancel.

## 2026-09-29 10:50 [BUG-P1]

Agent messages could not be selected — and therefore not copied — by long-pressing
on a touch device; user messages in the same stream selected normally.

Not a touch-event problem: neither message component registers a pointer or touch
handler. The difference is the render path. A user message is a plain `div`
(`LogEntry.tsx`, `UserMessageEntry`), while an agent message goes through
`MarkdownContent` → Shiki → `dangerouslySetInnerHTML`, and Shiki wraps its output in
`<pre class="shiki" tabindex="0">` which `.markdown-shiki .shiki` then made a
horizontal scroll container. A focusable element resolves a long press as focus, a
scrollable one resolves it as a pan; the global `* { touch-action: manipulation }`
compounds both.

- `MarkdownContent.tsx` sanitizes with `FORBID_ATTR: ['tabindex']`. DOMPurify's
  default allowlist includes `tabindex` (`dompurify/src/attrs.ts`), so the attribute
  had been surviving into the DOM.
- `.markdown-shiki .shiki` drops `overflow-x: auto` for `visible` — the rule already
  sets `white-space: pre-wrap` and `word-break: break-word`, so the body wraps and the
  horizontal scroll was redundant — and adds `touch-action: auto` plus an explicit
  `user-select: text`.

Not verified on hardware: `agent-browser`'s bundled Chrome will not start in this
container (`libatk-1.0.so.0` missing), and long-press-to-select only reproduces on a
real touch device. The three causes are confirmed at the code level (Shiki output,
CSS rule, DOMPurify allowlist). If selection still fails on a phone, `tabindex` is the
first suspect. Task: `20260929-1043-mobile-agent-message-selection`.

## 2026-10-01 15:42 [progress]

The desktop rail now reveals the full project list on hover. Two-letter initials
from `getProjectInitials()` collide, and the old per-button tooltip surfaced one
name at a time, so there was no way to scan the list.

- `AppSidebar.tsx`: new `ProjectFlyout` anchored to the right edge of the rail,
  listing every project as initials plus full name, active row marked with
  `aria-current`, scrolling via a `max-height` derived from the anchor so it
  cannot overflow the viewport. The per-button tooltip is gone.
- The rail and the flyout share one hover region and close on a 120 ms delay:
  crossing the gap fires `mouseleave` on the rail before `mouseenter` on the
  flyout, which would otherwise flicker it shut.
- Rail buttons still navigate on click; `MobileSidebar` and the rest of the rail
  are untouched. New i18n key `sidebar.projects` (en/zh).

Rejected alternative: expanding the whole rail on hover. The lower half carries
the connection indicator, terminal, notes, view-mode select, global pages and
settings, all of which would have had to become labelled rows.

Task: `20261001-1538-sidebar-project-flyout`.

## 2026-10-01 16:20 [BUG-P1]

The stale-working reconciler marked starting executions as failed. An issue showed
`sessionStatus: failed` + `statusId: review` while its engine process ran a whole
turn, correcting itself only when that turn settled.

`reconcileStaleWorkingIssues()` treats `working` with no registered process as
stale, but a start is `working` from `ensureWorking()` onward and only registers
its process after the executor's spawn resolves — 2.9 s in the reported case. A
pass landing before the engine took the issue lock moved the issue back to
`review`; a pass landing after it wrote `running` but before `register()` wrote
`failed` + `review`. Skipping `pending` did not help: every engine path overwrites
it with `running` before spawning, and the existing TOCTOU re-check reads the same
unregistered process. Reported rate: 66 of 2,032 starts over 2026-07-25..10-01,
rising with concurrency.

- `EngineContext.startsInFlight` counts starts per issue. `issueEngine.trackStart()`
  raises the count synchronously — before its first `await` — awaits the start and
  releases in `finally`; `issueEngine.isStarting()` reports it.
- Every start is wrapped from before its first write that commits the issue to
  `working` until the engine returns: the follow-up, execute and restart routes,
  the cron follow-up and execute actions, `flushPendingAsFollowUp()` and
  `triggerIssueExecution()`.
- The reconciler now skips an issue that has an active process **or** a start in
  flight, in the first pass and in the re-check before the transaction. Bun's
  SQLite transaction is synchronous, so a start is either seen by the re-check or
  begins after the UPDATE and writes `working`/`running` itself.
- Secondary fix: the `issue-updated` event carries
  `{ statusId: 'review', sessionStatus: 'failed' }` for the issues whose session
  status the reconciler rewrote, instead of `statusId` alone — a client applying
  the event used to keep showing the old session status until it refetched.

Investigation, evidence and the approved proposal came from the reporter; task
`20261001-1313-reconciler-start-race`.

## 2026-10-01 16:55 [progress]

The sidebar hover flyout now lists plain project names. The initials badge on each
row duplicated the rail buttons next to it and added nothing once the full name is
shown. Row padding was retuned for text-only rows, and the active row is marked with
`font-medium` on top of the existing highlight. The rail buttons keep their initials.

Considered and dropped: showing only a few pinned projects in the rail with a "more"
button for the full list. Follow-up to `20261001-1538-sidebar-project-flyout`.

## 2026-10-01 18:50 [progress]

Reworked the sidebar hover flyout so it reads as part of the rail. It was anchored to
the top of the whole project area, so it appeared in the same place whichever icon was
hovered and bore no visual relation to it.

- The flyout opens per icon: hovering a rail icon places the flyout so that project's
  row sits level with the icon. Moving to another icon re-levels it; the rows keep the
  initials badge (reverting the plain-text rows from the previous change), at the same
  36px size as the rail icon so the two line up.
- The row belonging to the hovered icon is tinted (`data-anchor`), so the pairing is
  visible while the pointer is still on the rail.
- Placement is the pure `placeFlyout()` in `lib/flyout-position.ts`: it keeps an 8px
  margin to the viewport edges and, for a list taller than the viewport, pins the flyout
  to the margins and scrolls the matching row into line.
- The measurement runs in a layout effect, so the flyout never paints at an unaligned
  position. Hover handlers moved from the rail container onto the icons; the container
  no longer has any.

Follow-up to `20261001-1538-sidebar-project-flyout`. As before, jsdom has no layout, so
the tests stub the geometry; the real alignment against a viewport needs a look in a
browser.

## 2026-10-02 10:45 [BUG-P0]

Engine processes leaked when the spawn succeeded but a later step failed. BKD
spawned the engine before registering it with the process manager, and nothing
killed the child when registration or the Codex handshake threw. The orphan kept
working on its prompt in the project directory, its output never reached BKD,
cancel could not reach it, and it did not count toward the concurrency limit.
An orphaned `codex app-server` also held the thread's writer lock, so every later
follow-up failed with `already has an active writer` and leaked one more process.
Present since the initial commit (`cdcaa8a`).

- `ProcessManager.assertCapacity()` holds the limit check that `register()` used
  inline. Execute, follow-up, retry and restart call it before spawning, so a full
  limit no longer starts a process or sends the prompt.
- Every post-spawn step (the `externalSessionId` write and `register()`) now runs
  inside the paths' existing try blocks. On failure the child is killed
  (`killUnregistered()`, SIGKILL to its process group) and the existing revert
  runs: session `failed`, the pre-persisted follow-up message removed. Before,
  a registration failure also left the session `running`.
- `spawnFresh` / `spawnWithSessionFallback` kill the child if the session-id
  write fails.
- `CodexExecutor.spawn` / `spawnFollowUp` close the handler and kill the
  app-server when `initialize`, the auth check, `thread/start`, `thread/resume`
  or `turn/start` fails.
- Tests: `engine-spawn-leak.test.ts` (limit full before the spawn, and filled
  while spawning, for execute / follow-up / restart) and
  `codex-spawn-cleanup.test.ts` (a fake app-server rejecting `thread/resume`).

Orphans already running on a host are not reaped by this change; kill them once
(or restart BKD). Task `20261002-1007-engine-process-leak`.

## 2026-10-02 11:14 [BUG-P1]

An issue with `useWorktree` could run in the project's main checkout.
`restartIssue` and `executeIssue` called `createWorktree` unconditionally; with
the worktree already present both `git worktree add` attempts fail, and every
path swallowed the error and fell back to the base directory. A restart or a
second execute of an isolated issue therefore always edited the main checkout.

- `ensureWorktree()` (`utils/worktree.ts`) returns the worktree when its
  directory exists and is registered under the project repo, and creates it
  otherwise. Execute, restart, retry and follow-up all use it.
- There is no fallback any more. When the worktree cannot be provided (project
  directory is not a git repo, no `main`/`master`, a stale directory at the
  path) the turn fails before anything is spawned: session `failed`, the git
  error in the chat, the pre-persisted follow-up message removed.
- Tests: `worktree-reuse.test.ts`.

Task `20261002-1111-worktree-reuse`.

## 2026-10-02 11:14 [BUG-P1]

`permissionMode` was accepted by issue create, execute and follow-up but never
stored. Turns with no request of their own — auto-retry, restart, the pending
flush, and the execute triggered by moving an issue to `working` — fell back to
the engine default, `auto`, so a `plan` or `supervised` issue was re-run with
full permissions after a failure.

- New nullable column `issues.permission_mode` (migration `0025`).
- Create stores the requested mode; `executeIssue` and `followUpIssue` store an
  explicit mode when one is passed; duplicate copies it.
- Execute, follow-up spawn, retry and restart resolve
  `explicit ?? stored ?? engine default`. Existing issues have `NULL` and behave
  as before.
- The mode is not part of the issue API response.
- Tests: `permission-mode-persist.test.ts`.

Task `20261002-1111-persist-permission-mode`.

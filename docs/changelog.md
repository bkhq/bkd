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

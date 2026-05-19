# Changelog

## 2026-05-19 14:45 [feat]

SEARCH-001 / PLAN-019 — In-chat full-text search + CJK-friendly tokenizer.

Solves "历史消息太多了，经常找不到": opening an issue now exposes a
`⌘F` / Ctrl+F search inside the conversation (also a `🔍` button in
the chat header for mobile), and the underlying FTS5 index now actually
ranks Chinese matches instead of falling back to noisy single-character
prefix scans.

Backend:
- Migration `0021_fts_bigram_rebuild.sql` drops the trigger-based FTS5
  pipeline and recreates `issue_logs_fts` with `unicode61
  remove_diacritics 2`. The bigram transform happens in the app layer
  (`apps/api/src/db/fts.ts`), keeping the standalone Bun binary free of
  native tokenizer extensions.
- App-layer double-write in `engines/issue/persistence/log-entry.ts`
  and `db/pending-messages.ts`. Startup `ensureFtsTokenizerVersion()`
  reindexes idempotently when the persisted tokenizer version changes.
- `searchLogs()` accepts an `{ issueId }` filter; the same option is
  surfaced through `GET /api/search/logs?issueId=...`. New
  `GET /api/projects/:projectId/issues/:id/logs/around/:logId?window=20`
  returns the entries bracketing a search hit for future deep-jump UX.

Frontend:
- `ChatSearchBar` — sticky bar inside the chat scroll viewport with
  ranked hit list, `↑/↓` + `Enter` / `Shift+Enter` navigation, `Esc`
  to close. Clicking a hit scrolls to the matching `[data-message-id]`
  bubble and flashes a yellow ring; out-of-window hits surface a
  "scroll up to load more" hint.
- Search icon + `⌘F` binding wired into `ChatArea`, both desktop and
  mobile.

Risk mitigations: source `issues_logs` is never touched; FTS rebuild is
idempotent; the `searchLogs()` LIKE fallback still kicks in if the
shadow is unavailable.

## 2026-05-19 05:30 [progress]

COCKPIT-006 / PLAN-018 — Cockpit reachability upgrade (frontend only).
Solves the two repeat complaints from daily use:
  "进 issue 后 dashboard 消失，切换要点好几次"
  "在驾驶舱下发新任务太麻烦"

Pieces shipped:
- `CockpitTopBar` (always visible, 34px): breadcrumb `🏠 / alpha ⚙️ /
  #N title` + action cluster `+ New / ⌘K / ⊞`. Project gear opens
  the existing `ProjectSettingsDialog` lazily — no need to leave
  cockpit to tweak env vars or system prompt. ⌥← / ⌥→ jumps
  through recent-issues history.
- `RecentTabs` (32px): up to 5 most-recently-visited issues with
  click-to-jump, × close, and a `+` shortcut to the create dialog.
  Active tab highlights based on the URL `issueId`.
- `MiniMatrix` (200px absolute card on chat right edge): per-project
  (project × status) counts that "follow" the user into an open
  issue. Click a cell → navigates to that project with status filter.
  Collapsible via the TopBar ⊞ button or its own ▲ icon; state
  persisted in `view-mode-store` + localStorage.
- `useRecentIssues` rewired to `useSyncExternalStore` so every
  component reacts when `addRecentIssue` / `removeRecentIssue` /
  `clearRecentIssues` writes. Previously the hook read localStorage
  exactly once on mount — strip would stay stale.
- `SearchContent` (⌘K palette): typing `#<N>` filters the Review
  group to issueNumber=N exact match across all projects in the set,
  so a Spotlight-style "jump to #12" works.
- `SuggestedPrompts`: 5th chip nudges the user to ask the assistant
  to create an issue in natural language ("在 alpha 建个 bug-fix
  issue 修 …").
- `CreateIssueDialog` is now mounted at `ReviewPage` root so the
  panel-store openCreateDialog hook works from any cockpit state
  (TopBar +, RecentTabs +, AssistantPanel proposal, ⌘N keyboard).
- Mobile keeps the existing segmented control + FAB; TopBar and
  RecentTabs are desktop-only to avoid mobile clutter (per the
  established mobile-first-class rule, but the rule allows desktop-
  only chrome when mobile equivalent is already present).

Test infrastructure:
- `test-setup.ts` polyfills `ResizeObserver` and `scrollIntoView`
  for jsdom — needed by cmdk + base-ui popovers used in
  SearchContent / Combobox.

TDD coverage:
- `__tests__/hooks/use-recent-issues.test.tsx` (6)
- `__tests__/components/MiniMatrix.test.tsx` (6)
- `__tests__/components/RecentTabs.test.tsx` (6)
- `__tests__/components/CockpitTopBar.test.tsx` (7)
- `__tests__/components/SearchContent.hash.test.tsx` (2)

Total: 286/286 frontend tests passing (was 253 → +33 new tests for
this batch alone). Lint clean (only the same 2 pre-existing
warnings unrelated to this work).

Known limitations / future work (deferred):
- ⌘K `#N` shortcut only matches within whatever `useReviewIssues`
  currently returns (default = review status). To search `#N` across
  all statuses, a new backend endpoint would be needed.
- QuickCreate's project picker still uses a native `<select>`. The
  upgrade to `Combobox` + "立刻执行" switch slipped this batch and
  becomes COCKPIT-007 follow-up.

## 2026-05-19 01:40 [progress]

COCKPIT-003 + COCKPIT-004 + COCKPIT-005 / PLAN-017 — Last three audit
items closed: bulk operations on the review list, issue templates in
the create flow, and a diff hover preview on done cards. All UI
changes shipped desktop + mobile per the mobile first-class rule.

### COCKPIT-004 — Issue templates
- `apps/api/src/cockpit/templates.ts` ships 5 built-in templates
  (bug-fix, refactor, add-tests, investigate, follow-up). User
  templates persist under `appSettings.cockpit:issueTemplates` and
  override built-ins by id.
- `GET /api/issue-templates` + `PUT /api/issue-templates`
  (zod-validated, max 50 user templates).
- New `IssueTemplateSelect` component (native `<select>` for mobile
  reliability) wired into both `CreateIssueForm` (kanban dialog) and
  `CockpitQuickCreate`. Selecting a template fills the title pattern
  and prepends `promptPrefix` to the user's typed title.
- 4 backend tests + 4 frontend tests.

### COCKPIT-003 — Bulk operations on review list
- New Zustand store `bulk-selection-store.ts` (Set<string> of
  selected issue ids).
- New `use-bulk-operations` hook with concurrency cap (5), running
  per-issue restart / cancel / status-update across project boundaries
  via existing endpoints (no backend changes needed).
- `ReviewListPanel` row gains a checkbox (hover-revealed on desktop,
  always-visible on mobile, 44×44 touch target). Group header gains a
  tri-state "select all in this project" checkbox.
- New `BulkOperationsBar` sticky at the bottom of the list panel:
  shows selected count + live progress + Restart / Cancel / Move-to
  dropdown.
- 4 frontend tests.

### COCKPIT-005 — Diff hover preview on done cards
- New `DoneDiffHover` wraps `KanbanCard` content when
  `columnStatusId === 'done'`. Hover opens a popover lazy-loading
  `useIssueChanges(projectId, issueId, open)` (only fetches once
  opened). Renders compact file list with `+N -M` line stats.
- Reuses existing `/api/projects/:projectId/issues/:id/changes`
  endpoint — no backend changes.
- 2 frontend tests.

### Bug caught by lint autofix
`Array.from({length}).fill(worker())` was the lint-autofix suggestion
for `Array.from({length}, () => worker())` in
`use-bulk-operations.ts`. **That suggestion is incorrect** — it
collapses N parallel worker promises into a single shared promise,
breaking concurrency. Reverted to an explicit `for` loop with a
comment warning. (pitfall)

### Test coverage delta
- backend cockpit suite: 40/40
- frontend full sweep: 218/219 (the 1 unrelated AppSidebar width
  assertion persists from earlier).
- lint: 0 errors, 2 pre-existing warnings.

### Now closed (all original audit items)
| pain point | status |
|---|---|
| 批量操作太弱 | ✅ ReviewListPanel multi-select + BulkOperationsBar |
| 日志只能看不能搜 | ✅ FTS5 (COCKPIT-002) |
| 没有 diff 高亮变化 | ✅ DoneDiffHover (COCKPIT-005) |
| 没有 issue 模板 | ✅ Built-ins + user templates (COCKPIT-004) |
| 跨项目搜索缺失 | ✅ /search + ⌘K + FTS5 logs section |
| 驾驶舱 dashboard | ✅ COCKPIT-001 |
| AI 助手 read-only | ✅ COCKPIT-A1 |
| AI 助手 write + 审批 | ✅ COCKPIT-A2 |
| AI 助手 reset + 建议 | ✅ COCKPIT-A3 |
| 移动端响应式 | ✅ throughout |

### Known limits / future
- Cron-driven autonomous assistant still deferred.
- Settings UI for managing user issue templates not built (PUT works).
- Per-project template overrides not supported.
- Hover popover is desktop-first; mobile users see the popover on
  tap but no long-press affordance.

## 2026-05-19 01:30 [progress]

COCKPIT-A2 + COCKPIT-002 + COCKPIT-A3 / PLAN-016 — Cockpit assistant
gains write capability (gated), full-text log search, and session
lifecycle. All UI changes shipped desktop + mobile per the mobile
first-class rule.

Backend (write tools with approval gate):
- New `apps/api/src/cockpit/proposals.ts` — in-memory proposal store
  (TTL 30 min) with `propose / get / listPending / markApproved /
  markRejected / markFailed`. Lost on restart by design.
- New MCP tool `cockpit_propose_action({type, summary, params})` —
  the AI cannot execute mutations directly; it can only queue
  proposals for the user to approve in the panel.
- New `routes/cockpit/proposals.ts` with three endpoints:
  - `GET /api/cockpit/proposals` (pending)
  - `POST /api/cockpit/proposals/:id/approve` — dispatches to
    `issueEngine.cancelIssue` / `issueEngine.restartIssue` /
    in-place bulk status update (capped at 50) / `create_issue`
    helper. Validates project + issue existence; capped + soft-only.
  - `POST /api/cockpit/proposals/:id/reject`
- SSE events `cockpit-proposal` + `cockpit-reset` added to both the
  shared `AppEventMap` + `SSEEventMap` and wired into
  `routes/events.ts`.
- Cockpit system prompt updated: AI must propose, never claim it
  acted directly.

Backend (FTS5 cross-project log search):
- New migration `0020_cockpit_logs_fts.sql` — `issue_logs_fts`
  virtual table (porter + unicode61 tokenizer) backfilled from
  existing visible logs; insert/update/delete triggers keep shadow
  in sync.
- `cockpitSearchLogs` MCP tool upgraded to FTS5 (`bm25()` ranking,
  prefix match on the last token) with defensive LIKE fallback.
- New `GET /api/search/logs?q=&limit=` route exposes the same to
  the frontend.

Backend (session reset):
- New `POST /api/cockpit/reset` soft-deletes the singleton issue
  + clears `appSettings.cockpit:assistantIssueId`. Next `/ask`
  creates a fresh session. Emits `cockpit-reset` SSE event.

Frontend (desktop + mobile):
- `AssistantPanel` gained:
  - `CockpitProposalsBanner` — amber strip above the chat lists
    pending proposals with Approve (✓ / 44×44 on mobile) and Reject
    (✕) buttons. Live-updated via the SSE `cockpit-proposal` listener
    on the event bus.
  - Reset button in header with `alert-dialog` confirmation.
  - `SuggestedPrompts` chip row shown when the session has no
    conversation yet (4 chips, 44px touch targets on mobile).
- `SearchContent` (already used by `/search` page + ⌘K palette)
  gained a "Logs" section using the FTS5 endpoint. Loads only when
  query length ≥ 2, ranked + truncated, click navigates to
  `/review/:projectAlias/:issueId`.
- New hooks: `useCockpitProposals`, `useApproveCockpitProposal`,
  `useRejectCockpitProposal`, `useCockpitReset` (in
  `hooks/use-cockpit-proposals.ts`).
- EventBus: `onCockpitProposal` + `onCockpitReset` listeners.
- New i18n keys: `cockpit.proposals.*`, `cockpit.assistant.reset*`,
  `cockpit.assistant.suggest.*`, `search.logs` (en + zh).

TDD coverage:
- `apps/api/test/cockpit-proposals.test.ts` (9 tests)
- `apps/api/test/cockpit-search-fts.test.ts` (8 tests — incl. trigger
  sync + hidden-issue isolation)
- `apps/api/test/api-cockpit-reset.test.ts` (2 tests)
- `apps/frontend/.../CockpitProposalsBanner.test.tsx` (4 tests)
- `apps/frontend/.../SuggestedPrompts.test.tsx` (2 tests)

Overall sweep: backend 36/36 cockpit suite, frontend 208/209 (the
single failure is the pre-existing AppSidebar width assertion noted
in earlier changelogs).

Known limits / follow-ups:
- Proposals are in-memory only (lost on server restart). Acceptable
  for short-lived approvals; persistence is a future enhancement.
- FTS5 search currently indexes log `content` only — not metadata or
  tool arguments. Adding tool calls would require a column-typed
  shadow plus index expansion.
- Autonomous mode (cron-driven cockpit checks + escalation) is still
  deliberately out of scope.

## 2026-05-19 01:15 [progress]

COCKPIT-A1 / PLAN-015 — Cockpit AI assistant (read-only) + responsive
cockpit. All UI changes shipped desktop + mobile in the same task per
the mobile-first-class feedback.

Backend:
- New `apps/api/src/mcp/cockpit-tools.ts` + `cockpit-server.ts` — in-process
  SDK MCP server (`createSdkMcpServer` / `tool()`) registering five
  read-only tools: `cockpit_get_stats`, `cockpit_list_issues`,
  `cockpit_get_issue`, `cockpit_recent_activity`, `cockpit_search_logs`.
- `claude-sdk` executor now attaches the cockpit MCP server when the
  spawn env carries `BKD_COCKPIT_ASSISTANT=1` — zero changes to
  `SpawnOptions` or orchestration plumbing.
- New `routes/cockpit/assistant.ts`:
  - `GET /api/cockpit/assistant` returns the singleton assistant pointer
  - `POST /api/cockpit/ask` first-turn-then-followup against the singleton
  - `GET /api/cockpit/_singleton` debug helper
- New `routes/cockpit/ensure-singleton.ts` — auto-creates an archived
  `__cockpit__` project + a hidden assistant issue (id pinned in
  `appSettings.cockpit:assistantIssueId`).
- TDD surfaced a hidden-issue leak in COCKPIT-001 routes; patched
  `/api/issues/review` and `/api/issues/stats` to filter `isHidden=false`.

Frontend (every component double-surface):
- New `components/cockpit/AssistantPanel.tsx` — desktop floating dock
  (`fixed right-4 top-16 bottom-4 w-[380px]`), mobile bottom `Sheet`
  85vh; wraps `<ChatBody>` against the assistant issue.
- New `AssistantFab.tsx` — floating action button on cockpit dashboard.
- `ProjectMatrix.tsx` — desktop grid table, `<md` collapses to
  vertical card stack with 4 status pills per project (44px+ targets).
- `CockpitQuickCreate.tsx` — popover ↔ bottom Sheet by viewport;
  ⌘N shortcut disabled on mobile.
- `pages/ReviewPage.tsx` — mobile-only `cockpitMode` state with new
  `MobileCockpitTabs` segmented control (`[List | Cockpit]`); desktop
  unchanged.
- New `hooks/use-cockpit-assistant.ts` — `useCockpitAssistant`,
  `useCockpitAsk`.
- New i18n keys `cockpit.assistant.*` (en + zh).

TDD coverage:
- `apps/api/test/cockpit-tools.test.ts` (11 tests)
- `apps/api/test/api-cockpit.test.ts` (6 tests)
- `apps/frontend/.../ProjectMatrix.mobile.test.tsx` (2 tests)
- `apps/frontend/.../CockpitQuickCreate.mobile.test.tsx` (2 tests)
- `apps/frontend/.../AssistantPanel.test.tsx` (4 tests)

Known limits / follow-ups:
- Read-only this round. Write tools (cancel/restart/bulk) deferred to
  COCKPIT-A2 with confirmation gates.
- Search uses `LIKE`; FTS5 deferred to COCKPIT-002.
- No session reset / context cap; deferred to COCKPIT-A3.
- Assistant unavailable if `claude-code-sdk` engine is not installed —
  panel falls back to loading state (graceful but not a friendly
  installer guide yet).

## 2026-05-19 00:50 [progress]

COCKPIT-001 / PLAN-014 — Upgraded `/review` page into a global cockpit
without introducing a new route.

Backend:
- `GET /api/issues/review` now accepts `?statuses=todo,working,review,done`
  (defaults to `review` for back-compat with the notifications hook).
- New `GET /api/issues/stats` returns per-project status counts.

Frontend:
- New `components/cockpit/` package: `ProjectMatrix`, `ActivityStream`,
  `CockpitQuickCreate`, `CockpitDashboard`.
- `ReviewPage` renders `<CockpitDashboard />` in the right pane when no
  issue is selected. The list panel shows status filter chips
  (default `working+review`) and per-row status dots.
- ⌘N / Ctrl+N opens an inline project-pick + title quick-create popover;
  no page switch required.
- New i18n keys under `cockpit.*` (en + zh).
- React Query invalidation refreshes all `useReviewIssues` variants
  + `useIssueStats` on `issue-updated` SSE events.

TDD coverage:
- `apps/api/test/api-issues-review.test.ts` (5 tests)
- `apps/api/test/api-issues-stats.test.ts` (2 tests)
- `apps/frontend/src/__tests__/components/ProjectMatrix.test.tsx` (3 tests)
- `apps/frontend/src/__tests__/components/ActivityStream.test.tsx` (4 tests)

Follow-up tasks: COCKPIT-002 cross-project log search (FTS5),
COCKPIT-003 bulk operations, COCKPIT-004 issue templates,
COCKPIT-005 inline diff hover preview.

## 2026-05-11 18:50 [BUG-P1]

Fix file path chips not opening the preview drawer when nested inside a
collapsible tool panel. `ToolPanel(collapsible)` renders a native
`<details><summary>` element; clicking anywhere inside the summary
triggers the browser's default toggle action regardless of React event
propagation. The chip button used `e.stopPropagation()` (which only
stops React bubbling) but did not call `e.preventDefault()`, so the
panel's toggle ran in parallel with the chip handler and the drawer
never materialized as expected. Added `preventDefault()` on both the
tool-call PathBadge and the free-text PathChip click handlers.

Files changed:
- `apps/frontend/src/components/issue-detail/ToolItems.tsx`
- `apps/frontend/src/lib/path-chips.tsx`

Tracking: FILE-002 / PLAN-011 (follow-up).

## 2026-05-11 18:10 [progress]

ChatInput toolbar density refactor + design-token primitives (UI-001 /
UI-002 / PLAN-012). The chat composer's bottom row used to pack 12
interactive elements (4 icon buttons + 4 config chips + 4 right-side
actions); on narrower laptops it overflowed and visually competed with
the textarea. The refactor folds the toolbar into three legible groups,
collapses three separate config chips into a single combined chip, and
hides three rarely-used desktop controls behind a "More" trigger.

- Engine + Mode + Model chips merge into a single `EngineConfigChip`
  whose surface shows `<EngineIcon> {mode} · {model}` and whose popover
  carries an immutable "current engine" header (so users never lose
  track of which engine the session is bound to, per user feedback).
- New desktop `DesktopMoreMenu` collects Refresh / Open files / Clear
  session into a `⋯` popover; mobile keeps `MobileMoreMenu`, now with
  an explicit "Current engine" label section since the combined chip
  isn't visible on small viewports.
- Diff status badge moves from the middle of the row to the right group,
  immediately left of Send — visually bound to the action cluster.
- New `<IconButton>` primitive maps a friendly `size: sm|md|lg` API onto
  the existing `<Button size="icon-*">` ladder + adds an `active` prop
  for selected-state surfaces, and a new `<Chip>` primitive consumes the
  new `chip-surface` CSS component class so the 5-line inline pill
  className soup no longer needs duplicating per call site.
- `apps/frontend/src/index.css` gains a small density-token scale
  (3 icon sizes, 4 control heights) under `@theme inline`, plus the
  `.chip-surface` component class with `data-active` / `disabled`
  variants. Visual output unchanged until consumers opt in.
- Dead code removed from `ChatInput.tsx`: the standalone `ModeSelect`
  and `ModelSelect` private components are no longer reachable after
  the combined chip subsumes them.
- New i18n keys: `chat.more`, `chat.configChipTitle`,
  `chat.configChipCurrentEngine` (en + zh).
- New test file `ChatInputDensity.test.tsx` (8 cases) pins the
  invariants: single combined chip, More menu contents, diff badge in
  the right group, popover engine header, model-less chip degrades
  cleanly, no duplicate diff badge. All 19 frontend test files (145
  tests) still pass.

This is phase 1+2 of a longer UI polish track. Phase 3 (KanbanColumn,
ProcessCard, Drawer headers, HomePage card balance) and phase 4 (color
ladder + hover-state consolidation) are deferred to a future PLAN.

## 2026-05-11 17:55 [progress]

Clickable file path chips in chat + quick file preview drawer (FILE-002 /
PLAN-011). Users can now click a file path inside an AI reply (whether
from a tool call summary or free-text mention) and the existing
`FileBrowserDrawer` slides in pointing at that file, scrolled to the
optional `:LINE` suffix. The drawer no longer steals focus from the chat
composer and closes on `Esc`, so review cycles stay fast.

- New `useFilePreview` hook (`apps/frontend/src/hooks/use-file-preview.ts`)
  composes `useIssueChanges` + `useProject` + the file-browser store into a
  single `{ knownPaths, openPreview }` API, with worktree-aware root
  resolution (prefers `/changes.root`, falls back to `project.directory`).
- `PathBadge` inside tool-call summaries (`ToolItems.tsx`) is now a button.
- `MarkdownContent` accepts optional `knownPaths` + `onPathClick`; when
  provided it wires inline path chips into p/li/td/em/strong via a
  text-node walk that skips `code`/`pre`/`a` subtrees.
- New `splitByKnownPaths` / `transformChildrenWithPathChips` utility
  (`apps/frontend/src/lib/path-chips.tsx`) with longest-match priority,
  `:LINE` / `:LINE-LINE` suffix capture, and strict path-boundary checks
  so `foo.tsx` does not accidentally match `foo.ts`.
- `useFileBrowserStore` gains `openAt({ projectId, issueId, rootPath,
  path, line })` + `targetFile` / `targetLine` state. Auto-enters
  fullscreen on `(max-width: 767px)` viewports for mobile sheet UX.
- `FileViewer` scrolls to the target line after Shiki render, tagging
  `.line` spans with `data-line` and applying a 2-second pulse highlight.
  A new "Go to line" input in the header lets users jump manually.
- New `TableViewer` component (`apps/frontend/src/components/files/`)
  branches on extension: `.csv` / `.tsv` parse via papaparse, `.xlsx` /
  `.xls` fetch raw bytes + parse via dynamic-imported sheetjs. Sheet tabs
  for multi-sheet xlsx, `@tanstack/react-virtual` for large tables,
  1000-row cap with truncation banner.
- `FileBrowserDrawer` registers a window-level `Esc` listener (scoped to
  while-open, ignored when the active element is an input / textarea /
  contenteditable) and restores the previously-focused element on close.

Test invariants added:

- `path-chips.test.tsx` (13 tests): normalization, sort order, dedup,
  longest-match, `:LINE` capture, range suffix, boundary rejection for
  both leading and trailing path characters.
- `file-browser-store-openAt.test.ts` (7 tests): path normalization,
  zero-line clearing, mobile fullscreen via matchMedia, target cleanup
  on `close`, per-issue path cache continuity.

Test coverage delta: frontend 117 → 137 tests (all passing).

New deps:

- `papaparse@5.5.2` (csv, eager) + `@types/papaparse` dev type
- `xlsx@0.20.3` via the SheetJS community tarball
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`).
  Dynamic-imported only when an xlsx file is opened.

Files changed:

- `apps/frontend/src/components/issue-detail/ToolItems.tsx`
- `apps/frontend/src/components/issue-detail/MarkdownContent.tsx`
- `apps/frontend/src/components/issue-detail/LogEntry.tsx`
- `apps/frontend/src/components/files/FileViewer.tsx`
- `apps/frontend/src/components/files/FileBrowserDrawer.tsx`
- `apps/frontend/src/components/files/FileBrowserContent.tsx`
- `apps/frontend/src/components/files/TableViewer.tsx` (new)
- `apps/frontend/src/stores/file-browser-store.ts`
- `apps/frontend/src/hooks/use-file-preview.ts` (new)
- `apps/frontend/src/lib/path-chips.tsx` (new)
- `apps/frontend/src/i18n/en.json`, `apps/frontend/src/i18n/zh.json`
- `apps/frontend/src/__tests__/lib/path-chips.test.tsx` (new)
- `apps/frontend/src/__tests__/lib/file-browser-store-openAt.test.ts` (new)
- `apps/frontend/src/__tests__/components/AssistantCopy.test.tsx`
- `apps/frontend/package.json` (papaparse, xlsx, @types/papaparse)

Tracking: FILE-002 / PLAN-011.

## 2026-05-10 15:25 [progress]

Lift the chat attachment upload ceiling from 10 MB to 100 MB so users can
send a project tarball / zip as a seed for AI initialization, and add
visible upload progress so multi-second uploads no longer feel like the
UI hung.

- `apps/api/src/uploads.ts` — `MAX_FILE_SIZE` 10 MB → 100 MB.
  `MAX_FILES` stays at 10.
- `apps/api/src/index.ts` — `Bun.serve maxRequestBodySize` raised to
  1040 MB so the worst-case multipart batch (10 × 100 MB + framing)
  is accepted at the runtime layer.
- `apps/frontend/src/lib/kanban-api.ts` — `postFormData` rewritten on
  top of `XMLHttpRequest` (fetch can't surface upload progress) and
  `followUpIssue` exposes an `onUploadProgress` callback.
- `apps/frontend/src/components/issue-detail/ChatInput.tsx` — chips
  stay visible during upload with the remove button disabled; a
  whole-batch progress bar + tabular percent renders in the chip
  strip; on failure chips and input both stay so the user can retry
  without re-picking files.
- i18n: `chat.attachHint`, `chat.uploadProgress_*`,
  `chat.uploadStarting_*` added in both `en.json` and `zh.json`. The
  paperclip tooltip now mentions the seed-capable behaviour ("zip /
  tar.gz works — AI will extract").

Verification:
- 5 new backend tests in `apps/api/test/uploads-large.test.ts`.
- 4 new frontend tests in `apps/frontend/src/__tests__/lib/kanban-api-upload.test.ts`.
- Frontend total 86 → 90 pass; backend converter / upload subset 48 → 53 pass.
- Lint: zero new violations from this task.

Tracking: FILE-001 / PLAN-008.

Out of scope: chunked / resumable uploads. Trigger condition for the
follow-up FILE task: real user reports of >100 MB uploads failing
mid-transfer often enough to matter.

## 2026-05-10 12:55 [BUG-P0]

Close residual chat UI ordering bugs the targeted nine-bug fix
(`05ec320..e1d5273`) didn't reach, and seal the test invariant gaps that
let them slip through.

Root causes addressed:

1. `liveConverter` (long-lived singleton) and `toTimeline` (per-call fresh
   converter) computed different `sequence` values for the same entry. On
   `onDone` `/logs` refetch, ids matched but sequences differed → frontend
   `compareTimeline` re-sorted and the timeline visibly jumped.
2. `nextSequence` used `ts*1000 + subSeq`, which wasn't monotonic when an
   engine emitted a chunk with a backward timestamp (some ACP/Codex flows
   do).
3. Segment ids used a bare numeric suffix (`thinking-10` lex-sorts before
   `thinking-2`), so once `compareTimeline` ties were broken by id the
   long-turn order was wrong.
4. `appendServerMessage` sequence (`Date.now() * 1000`) could be smaller
   than already-rendered system / loading entries; the canonical replacement
   then re-sorted the user message after them.
5. Scope-change effect called `clearLogs()` after the inline render block
   restored cached logs, defeating the LRU cache.
6. `compareTimeline` "legacy first" branch was a fragile escape hatch — a
   single missing `sequence` pinned an entry ahead of every properly-
   sequenced one.
7. `removeEntries` filtered by converter `id` (`turn-N-...`) but
   `emitIssueLogRemoved` ships raw ULIDs; pending recall via
   `DELETE /pending` left rendered entries visible until next refresh.
8. `toTimelineEntry(entry)` legacy single-arg export used a global
   `'__legacy__'` issue bucket; not called anywhere in the tree, but
   shipping it made cross-issue corruption a one-import-away regression.
9. `MarkdownContent` rewrite turned assistant messages from
   Shiki-tokenized raw markdown into rendered HTML; the pre-existing
   Copy button was `opacity-0 group-hover:opacity-100` so users couldn't
   find the only path back to raw markdown.

Fix:

- `nextSequence` rewritten as `max(ts * 1000, lastSeq + 1)` — strictly
  monotonic per issue and identical across live/batch paths.
- Buffer ids zero-padded to 4 digits (`turn-N-thinking-0042`); lex-sort
  matches numerical insertion order for any realistic turn length.
- `toTimeline` no longer pre-sorts entries — DB queries already return in
  ULID/wire order; the defensive sort was producing different
  `nextSequence` traces than the live wire-order ingest.
- Frontend `appendServerMessage` uses
  `max(maxLiveSeq + 1, Date.now() * 1000)` so the optimistic bubble
  always lands at the bottom regardless of in-flight noise.
- Scope-change effect no longer calls `clearLogs()`; render-time inline
  block remains responsible for state reset + cache restore.
- `compareTimeline` simplified to `(sequence, id)`; legacy-first branch
  removed. `toTimelineEntry` synthesizes `sequence` whenever upstream
  forgot to assign it, so the simplified comparator can rely on the
  field always being present.
- `removeEntries` matches by `id` OR `messageId`.
- Legacy `toTimelineEntry(entry)` single-arg export deleted.
- Assistant message Copy button baseline opacity raised to 30, tooltip
  retitled "Copy markdown source" / "复制 Markdown 原文".

Test invariants added (the gap was the bug):

- Backend (`timeline-converter.invariants.test.ts`): equivalence test now
  asserts `sequence` parity across live and batch (previously waived);
  new "out-of-order timestamps still strictly monotonic" and "20-segment
  long turn preserves numerical order" invariants.
- Frontend (`use-issue-stream.invariants.test.tsx`): three new invariants
  covering optimistic-vs-canonical position with intermediate entries,
  LRU cache survival across issue switches, and pending recall by raw
  messageId.
- Frontend (`AssistantCopy.test.tsx`, new file): asserts Copy button
  writes raw markdown source to clipboard and is not opacity-0.

Coverage delta: backend converter 47 → 48 tests; frontend 80 → 86 tests.

Files changed:
- `apps/api/src/engines/timeline-converter.ts`
- `apps/api/src/engines/timeline-converter.test.ts`
- `apps/api/src/engines/timeline-converter.invariants.test.ts`
- `apps/frontend/src/hooks/use-issue-stream.ts`
- `apps/frontend/src/__tests__/hooks/use-issue-stream.invariants.test.tsx`
- `apps/frontend/src/__tests__/components/AssistantCopy.test.tsx` (new)
- `apps/frontend/src/components/issue-detail/LogEntry.tsx`
- `apps/frontend/src/i18n/en.json`
- `apps/frontend/src/i18n/zh.json`

Tracking: CHAT-002 / PLAN-007.

## 2026-05-09 10:35 [BUG-P1]

Fix OpenCode (ACP) hanging indefinitely when quota is exhausted or API calls fail. Added a 10-minute timeout around `connection.prompt()` in `AcpProtocolHandler.runPrompt()`. When timeout fires, the handler now emits `acp-error` and `acp-prompt-result` events so the frontend shows a clear failure message instead of a perpetual "thinking" state. Also attempts to cancel the hung session to free resources.

Files changed:
- `apps/api/src/engines/executors/acp/protocol-handler.ts`
- `apps/api/src/engines/issue/constants.ts`

## 2026-05-19 18:00 [progress]

COCKPIT-007 / PLAN-020 M1 — Always-on bot timeline (replaces cockpit
Overview).

The cockpit Overview no longer shows ProjectMatrix + ActivityStream as
the primary surface. Instead, a persistent bot-authored timeline reads
each issue that settles into `review` and posts:
- `suggest_merge` — diff looks clean, last assistant turn is conclusive,
  no pending AskUserQuestion. One-click "Move to done" via a new
  `merge_issue` proposal type (status-only flip; no git ops).
- `alert_off_track` — diff touched > 8 files (M1 heuristic). Suggests
  taking a look or cancelling the run.

Pure event-driven (no polling): the digest bridge listens on
`issue-updated` (engine-source review transitions) and `changes-summary`
events; cold-start scans review-status issues on boot.

ProjectMatrix + ActivityStream stay reachable under a lazy-mounted
"Show raw activity" disclosure — closed state does not subscribe to SSE.

M2 (reply drafts, repeated-failures bucket, bulk-merge with
overlap detection, snooze presets) and M3 (mobile swipe, telemetry,
a11y) are not in this slice.

Files changed:
- `apps/api/drizzle/0022_cockpit_timeline.sql`
- `apps/api/src/db/schema.ts`
- `apps/api/src/cockpit/timeline.ts` (new)
- `apps/api/src/cockpit/classifier.ts` (new)
- `apps/api/src/cockpit/digest-bridge.ts` (new)
- `apps/api/src/cockpit/proposals.ts`
- `apps/api/src/routes/cockpit/timeline.ts` (new)
- `apps/api/src/routes/cockpit/proposals.ts`
- `apps/api/src/routes/api.ts`
- `apps/api/src/routes/events.ts`
- `apps/api/src/index.ts`
- `packages/shared/src/index.ts`
- `apps/frontend/src/components/cockpit/BotTimeline.tsx` (new)
- `apps/frontend/src/components/cockpit/CockpitDashboard.tsx`
- `apps/frontend/src/hooks/use-cockpit-timeline.ts` (new)
- `apps/frontend/src/hooks/use-kanban.ts`
- `apps/frontend/src/lib/event-bus.ts`
- `apps/frontend/src/lib/kanban-api.ts`
- `apps/frontend/src/i18n/{en,zh}.json`

Tracking: COCKPIT-007 / PLAN-020.

## 2026-05-19 18:50 [progress]

COCKPIT-007 / PLAN-020 M2 — Reply input + repeated-failure tracking +
bulk merge.

Three new bot-timeline kinds + actions:
- `suggest_reply` — fires when `AskUserQuestion` is detected in the
  last turn. Row renders an inline `<Textarea>`; submitting calls
  `send_reply` proposal, which dispatches `issueEngine.followUpIssue()`
  on the user's behalf. No LLM-drafted reply (deferred to M3); the
  user types it directly. AskUserQuestion no longer blocks the
  timeline — it diverts merge → reply.
- `alert_repeat_fail` — in-process rolling counter of failed /
  cancelled executions per issueId in a 24h window. Threshold 3
  triggers the row. Fires regardless of issue status (working /
  review). Successful completion resets the counter. Takes priority
  over merge / off-track buckets so noisy issues surface first.
- `bulk_merge` proposal — bulk-merges up to 5 issues in one shot.
  Bulk-merge UI on the timeline shows a select-all + per-row
  checkbox, runs through an `AlertDialog` that lists the affected
  rows before the user confirms. Cap enforced server-side too.

Removed:
- Old behavior: AskUserQuestion silently blocked merge with no row.
  Replaced by the explicit `suggest_reply` bucket above.

Files changed:
- `apps/api/src/cockpit/classifier.ts` (failure tracker + reply +
  repeat-fail builders)
- `apps/api/src/cockpit/digest-bridge.ts` (subscribe to `done`)
- `apps/api/src/cockpit/proposals.ts` (new types)
- `apps/api/src/cockpit/timeline.ts` (bucketCounts shape)
- `apps/api/src/routes/cockpit/proposals.ts` (`bulk_merge`,
  `send_reply` dispatchers + execute allowlist)
- `apps/api/test/cockpit-classifier.test.ts` (+3)
- `apps/api/test/cockpit-bulk-merge.test.ts` (new, 7 tests)
- `packages/shared/src/index.ts` (kinds + reply-input action)
- `apps/frontend/src/components/cockpit/BotTimeline.tsx` (bulk
  toolbar, confirm dialog, inline reply textarea, two new buckets
  in status strip)
- `apps/frontend/src/hooks/use-cockpit-timeline.ts` (counts shape)
- `apps/frontend/src/i18n/{en,zh}.json` (M2 keys)
- `apps/frontend/src/__tests__/components/BotTimeline.test.tsx`
  (+3: bulk toolbar visibility, bulk select-all + confirm dispatch,
  reply input + send dispatch)

Verification:
- New API tests: 42 pass / 0 fail (3 files, classifier + timeline +
  merge_issue + bulk_merge/send_reply).
- New frontend tests: BotTimeline 10/10 pass.
- Full api suite: 692 pass / 6 fail (pre-existing flakes) / 1 skip.
- Full frontend suite: 320 pass / 0 fail (51 files).
- `bun run lint`: clean (3 pre-existing warnings).

Tracking: COCKPIT-007 / PLAN-020.

## 2026-05-19 19:40 [progress]

COCKPIT-007 / PLAN-020 M3 — Stale-in-working + deep-link + snooze
presets + sound alerts.

Four shipped:
- **`alert_stale_working` bucket**: a periodic check every 10 minutes
  (first sweep 60s after boot) finds issues stuck in `working` with
  no log activity for ≥ 15 minutes and posts a row offering Cancel /
  Restart / Open. This is the one place PLAN-020 accepts a timer —
  staleness is time-derived, not event-derived.
- **Deep-link routing**: the timeline `navigate` action now jumps
  straight to `/review/<projectAlias>/<issueId>` (via the existing
  ReviewPage route) instead of bouncing through `/review`.
- **Snooze presets**: per-row Snooze button became a dropdown with
  three presets — `1 hour`, `4 hours`, `Until tonight` (= local
  23:59). The old single-button payload still works as a
  back-compat fallback.
- **Sound + browser notification opt-in**: a Bell / BellOff toggle
  in the status strip. Off by default. When on, urgent kinds
  (`alert_off_track` / `alert_repeat_fail` / `alert_stale_working` /
  `suggest_reply`) play a short synthesized ding on each SSE append
  and (if granted) fire a generic-title browser Notification.
  Toggle state persists in `localStorage`. The toggle-on action
  also unlocks AudioContext and requests notification permission in
  one user gesture.

Files changed:
- `apps/api/src/cockpit/classifier.ts` (`buildStaleMessage`,
  `issueIdleMinutes`, `listStaleWorkingIssueIds`, stale trigger)
- `apps/api/src/cockpit/digest-bridge.ts` (10-min stale interval +
  initial 60s sweep + teardown)
- `apps/api/src/cockpit/timeline.ts` (bucketCounts shape)
- `apps/api/test/cockpit-classifier.test.ts` (+2: stale bucket
  positive + non-working refusal)
- `packages/shared/src/index.ts` (new kind)
- `apps/frontend/src/components/cockpit/BotTimeline.tsx`
  (`playDing`, `endOfTodayMs`, Bell toggle, SSE-driven alert,
  snooze DropdownMenu, deep-link, stale row tag + count)
- `apps/frontend/src/hooks/use-cockpit-timeline.ts` (counts shape)
- `apps/frontend/src/i18n/{en,zh}.json` (M3 keys)
- `apps/frontend/src/__tests__/components/BotTimeline.test.tsx`
  (+3: sound toggle persistence, snooze dropdown presence, 4h
  preset; updated 1h preset to use dropdown path)

Verification:
- New cockpit tests: 34 pass / 0 fail (4 backend files).
- BotTimeline: 13/13 pass.
- Full api: 694 pass / 6 fail (same pre-existing flakes) / 1 skip.
- Full frontend: 323 pass / 0 fail (51 files).
- Lint + typecheck clean.

Pending (still M3+):
- LLM-drafted reply (lazy, cached).
- Path-overlap detection on bulk merge.
- Mobile swipe (reveal-then-tap) + long-press a11y fallback.
- Telemetry on accept / open-instead / reverse.
- AskUserQuestion exact tool-call match (waiting on ENG-002).

Tracking: COCKPIT-007 / PLAN-020.

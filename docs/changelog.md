# Changelog

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

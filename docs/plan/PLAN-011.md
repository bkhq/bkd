# PLAN-011 Clickable file path chips with quick preview drawer

- **status**: completed
- **createdAt**: 2026-05-11 14:30
- **approvedAt**: 2026-05-11 14:50
- **completedAt**: 2026-05-11 17:55
- **relatedTask**: FILE-002

## Context

### User-stated need

"AI 输出了文件路径，我想点一下就能预览，不用打开文件浏览器一个个搜。
反复改一个东西时，能快速点进去 check，退出来继续聊。"

Quick-in / quick-out is the key UX constraint. Aggregate review panels,
diff-vs-full toggles, and inline editing are out of scope.

### Existing capabilities (already in place)

- `apps/frontend/src/components/issue-detail/ToolItems.tsx:129-133`
  defines `PathBadge` — currently a non-interactive `<code>` element used
  inside `FileToolItem` summaries (Read at line 221, Edit/Write at 246).
- Tool-call inline diff rendering already works:
  `ShikiUnifiedDiff` (256-264), `ShikiPatchDiff` (280-286), ACP diffs
  (288-301). Diff parsing via `parseFileToolInput` in `CodeRenderers.tsx`.
- `apps/frontend/src/stores/file-browser-store.ts` exposes:
  - `open(projectId, rootPath?)` — global drawer
  - `openForIssue(projectId, issueId, rootPath?)` — inline panel scoped
    to an issue (right-side analogue of a drawer; reuses ChatArea split)
  - `openFullscreen(projectId, rootPath?)` — fullscreen takeover
  - `navigateTo(path)` — change current path within an open session
  - Per-context path cache (`contextKey`, `switchContext`) survives
    context switches.
- `apps/frontend/src/components/files/FileViewer.tsx` renders text via
  Shiki (`codeToHtml`) and markdown via `MarkdownRenderer`. Line count
  is computed (line 102) but there is no line-jump / highlight API.
- Backend file content: `GET /api/files/:root/show` returns
  `{ path, content, size, isTruncated, isBinary, type }` (1 MB cap).
  Raw download: `GET /api/files/:root/raw*`.
- Issue-scoped change tracking: `GET /api/projects/:id/issues/:id/changes`
  returns the full list of touched files (`changes.ts`). SSE event
  `changes-summary` already pushes counts in real time.
- `NormalizedLogEntry.toolAction` (in `packages/shared/src/index.ts`)
  encodes `file-read` and `file-edit` actions with a `path` field —
  the authoritative whitelist source for free-text matching.

### Gaps to close

1. `PathBadge` is non-interactive — no click handler, no chip semantics.
2. No "open file at line" API on the file browser store; existing entry
   points open the directory listing or a cached path, not a target file
   plus line.
3. `FileViewer` has no scroll-to-line / highlight-line capability.
4. Free-text paths inside assistant `MarkdownRenderer` output stay as
   plain text — no whitelist post-processing.
5. xlsx / csv files have no preview branch; current viewer either treats
   them as text or refuses (binary).
6. No focus-preservation contract — opening any drawer today does not
   guarantee the chat input keeps focus, and there is no global `Esc`
   handler scoped to FileBrowserDrawer.
7. Mobile detection: existing fullscreen mode is opt-in. Need an
   automatic switch on small viewports for chip-triggered previews.

### Drawer coordination (already safe)

`TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer` use
independent Zustand stores and can coexist. No mutual-exclusion changes
needed.

## Proposal

### Step 1 — Make `PathBadge` a clickable chip

File: `apps/frontend/src/components/issue-detail/ToolItems.tsx`

Convert `PathBadge` from a `<code>` span to a `<button>`. Accept an
optional `line?: number` and call a shared hook
`useOpenFilePreview()` (see Step 3). Keep visual style identical; add a
hover ring and `aria-label`. Pass `line` through from `FileToolItem`
when the tool action carries one (Edit/Read may include line ranges in
metadata for some engines).

### Step 2 — Whitelist match for free-text mentions

File: new `apps/frontend/src/components/issue-detail/PathChipText.tsx`

Add a small component that wraps assistant `MarkdownRenderer` output:
walk the rendered React tree's text nodes, run a deterministic string
search against the issue's "known paths" set, and replace exact matches
(plus optional `:LINE` suffix) with `<PathBadge>`.

Known-paths source: derived in `ChatBody` from the current session's
`NormalizedLogEntry[]` by collecting every `toolAction.path` value plus
the `changes.files[].path` list from the `/changes` query (already
fetched by `useChangesSummary`).

Normalization rules (kept minimal):

- Strip leading `./`
- Treat `\\` as `/` on display (Windows paste safety)
- Match longest path first (avoid `foo.ts` matching inside
  `src/foo.ts`)

Hard limits to keep this safe:

- Only match paths in the known set — never regex-detect new strings.
- Skip if known set is empty.
- Skip inside `<code>` / `<pre>` rendered blocks (already chips via
  syntax highlighting, double-wrap would look wrong).

### Step 3 — Extend `file-browser-store` with "preview at path"

File: `apps/frontend/src/stores/file-browser-store.ts`

Add new state fields:

- `targetFile: string | null` — relative path inside `rootPath`
- `targetLine: number | null`

Add new action:

```ts
openAt: (params: {
  projectId: string
  issueId: string
  rootPath?: string
  path: string
  line?: number
}) => void
```

Behavior:

- Sets `isOpen=true`, mode auto-derived (drawer on desktop, fullscreen
  on mobile via media query check inside store helper).
- Sets `currentPath` to the parent directory of `path` so the file list
  shows the right folder.
- Sets `targetFile` / `targetLine` for the viewer to pick up.
- Reuses existing `switchContext` for cache continuity.

Add a thin hook `useOpenFilePreview(issueId)` in
`apps/frontend/src/hooks/use-file-preview.ts` that wires the store to
the current issue / project / worktree-aware root and returns a
single `(path, line?) => void` callback. Centralizes path resolution so
chip components stay dumb.

### Step 4 — Line-jump in `FileViewer`

File: `apps/frontend/src/components/files/FileViewer.tsx`

After Shiki produces HTML, attach `data-line` attributes per line and:

- Scroll the target line into view (anchored at ~30% from the top).
- Add a subtle highlight class for 2s.
- Show a "Go to line" input in the toolbar (already partially present
  per `lineCount` rendering at line 102 — add the input, wire to the
  same scroll-into-view function).

Pull `targetFile` / `targetLine` from the store; clear them after the
scroll fires so re-mount doesn't re-trigger.

### Step 5 — xlsx / csv preview branch

File: new `apps/frontend/src/components/files/TableViewer.tsx`

In `FileViewer`, route by extension before the Shiki path:

- `.csv` / `.tsv` → dynamic `import('papaparse')`, render up to 1000
  rows in a virtualized table (tanstack-virtual already a dep candidate;
  check before adding).
- `.xlsx` / `.xls` → dynamic `import('xlsx')` (sheetjs community
  build), expose Sheet tabs at the top, render the active sheet via
  the same table component.
- Show "Showing first N of M rows" banner when truncated, plus a raw
  download link via the existing `/api/files/:root/raw*` route.

Backend already serves the bytes via the `raw` endpoint; we will fetch
as `ArrayBuffer` and parse in the browser. No new backend route.

### Step 6 — Focus preservation + `Esc` to close

File: `apps/frontend/src/components/files/FileBrowserDrawer.tsx`

- Set `tabIndex={-1}` on the drawer root and do NOT auto-focus on open.
- Register a window-level `keydown` listener while the drawer is open:
  `Esc` → `close()`. Don't intercept when the active element is inside
  an editor / textarea inside the viewer (so editing isn't blocked).
- Track which element had focus before open; on close, if still
  mounted, restore focus to it. The chat composer's textarea ref is
  exposed via the existing message-input component.

### Step 7 — Mobile auto-fullscreen on chip click

In `openAt` (Step 3): consult `window.matchMedia('(max-width: 640px)')`
and set `isFullscreen=true` automatically when the trigger came from a
chat chip. Manual `open` / `openForIssue` keep existing behavior.

For mobile drawer styling, swap to a bottom-sheet layout via Tailwind
breakpoints in `FileBrowserDrawer.tsx`. Down-swipe gesture is OUT of
scope for MVP — `Esc` / back button / explicit close button are enough.

### i18n

Add keys in both `apps/frontend/src/i18n/en.json` and `zh.json`:

- `fileBrowser.gotoLine` ("Go to line" / "跳转到行")
- `fileBrowser.previewTruncated` (xlsx/csv truncation banner)
- `fileBrowser.sheetTabs` (xlsx sheet selector aria label)
- `tools.openFilePreview` chip aria-label template
  ("Preview {{path}}" / "预览 {{path}}")

### Test coverage

New vitest cases:

- `PathChipText.test.tsx` — whitelist match correctness, longest-match
  priority, `:LINE` suffix parsing, `<pre>` block skip.
- `file-browser-store.test.ts` — `openAt` cache continuity, mobile
  fullscreen branch, target clearing on close.
- `FileViewer.scrollToLine.test.tsx` — line attribute presence, scroll
  call on `targetLine` change.
- `TableViewer.test.tsx` — csv parse, xlsx multi-sheet rendering with a
  small fixture, truncation banner at threshold.

No backend tests required — no new API routes.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Whitelist match wraps already-styled code spans, producing nested chips. | Low | Skip nodes inside `<code>` / `<pre>` during the text-node walk. |
| Free-text path with weird prefix (`./`, `apps/api//foo.ts`) misses the whitelist. | Low | Minimal normalization (strip `./`, collapse `//`). Mismatches degrade gracefully to plain text. |
| `xlsx` package adds ~400 KB to the bundle. | Medium | Dynamic `import()` only when user opens an xlsx file; never on first paint. |
| `papaparse` dep collision / version conflict. | Low | Pin via root `package.json` Catalog if accepted; otherwise inline a minimal CSV parser. |
| Worktree path resolution skew: chip path is relative to worktree but viewer reads from project root. | Medium | `useOpenFilePreview` reads issue → worktree mapping via existing `resolveIssueDir` server logic (no client change required if the backend `/files` route already honors worktree-aware root). Verify during implementation. |
| `Esc` handler interferes with modal stacking. | Low | Only register when this drawer is open AND no nested editor / modal child reports its own handler. |
| Mobile viewport check inside Zustand setter is non-reactive on resize during open. | Low | Set once at open time; this matches the "quick in / quick out" use case. |
| Cumulative bundle growth across xlsx + papaparse + virtualized table. | Medium | Strict dynamic import; measure pre/post with `vite build` size report. |
| Re-opening drawer at a different file flickers when shiki re-renders. | Low | Keep current `Suspense` boundary; key the viewer by path so React can swap cleanly. |

## Scope

Files touched:

- `apps/frontend/src/components/issue-detail/ToolItems.tsx` (chip click)
- `apps/frontend/src/components/issue-detail/PathChipText.tsx` (new)
- `apps/frontend/src/components/issue-detail/ChatBody.tsx` (wire
  known-paths into `MarkdownRenderer` consumers)
- `apps/frontend/src/components/issue-detail/MarkdownRenderer.tsx`
  (accept post-process plugin or expose render slot)
- `apps/frontend/src/components/files/FileBrowserDrawer.tsx` (focus +
  Esc + mobile sheet)
- `apps/frontend/src/components/files/FileViewer.tsx` (line jump +
  TableViewer routing)
- `apps/frontend/src/components/files/TableViewer.tsx` (new)
- `apps/frontend/src/stores/file-browser-store.ts` (`openAt`,
  `targetFile`, `targetLine`)
- `apps/frontend/src/hooks/use-file-preview.ts` (new)
- `apps/frontend/src/i18n/{en,zh}.json`
- New tests under `apps/frontend/src/__tests__/...`

Estimated diff: ~600-900 lines across ~10 files. No backend changes
required for MVP (every needed API already exists).

## Alternatives

### A. Stand up a separate `FilePreviewDrawer`

Rejected. Doubles drawer coordination, duplicates viewer code, and the
user explicitly pushed back on adding components ("文件浏览器跟这个的
抽屉的关系是什么？是不是职责重叠了").

### B. Inline popover anchored to the chip

Rejected. Smaller cognitive disruption but pushes other messages down,
breaks scroll anchoring (just shipped in CHAT-004 / CHAT-005), and
fights long files. User picked "modal or side drawer" earlier.

### C. Aggregate "Files changed" review panel as primary entry

Deferred. Strong industry pattern (Codex Web, Copilot Workspace) but
user said the request is simpler than that. Revisit when chat-driven
chip flow is in production and we have feedback.

### D. Free-text regex path detection with `fs.exists` validation

Rejected. False-positive risk on common nouns; requires new backend
existence endpoint; async validation flicker. Whitelist match against
the already-known set covers the realistic "AI just touched this file"
flow without any of these costs.

### E. Snapshot the file at tool-call time and preview that snapshot

Rejected. Storage cost grows with every Edit/Write; "current file" is
what users actually want when iterating. The viewer can surface a
"file changed since" hint later if it becomes a pain.

## Annotations

(awaiting user approval)

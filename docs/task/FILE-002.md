# FILE-002 Clickable file path chips in chat with quick file preview drawer

- **status**: completed
- **priority**: P1
- **owner**: Claude
- **createdAt**: 2026-05-11 14:30
- **completedAt**: 2026-05-11 17:55

## Description

Make file paths inside assistant chat messages clickable so users can quickly
verify what the AI just touched without manually opening the file browser
and searching.

Two path sources are surfaced as chips:

1. Tool call parameters (Edit / Write / Read `file_path`)
2. Free-text mentions inside assistant messages whose string matches an
   already-touched file in the current issue (whitelist match — no regex
   guessing, no `fs.exists` probing)

Clicking a chip opens the existing `FileBrowserDrawer` in a "preview at
path" mode:

- Desktop: right-side drawer (existing behavior)
- Mobile: full-screen bottom sheet
- Drawer does NOT steal focus from the chat input; `Esc` closes it
- Text files: Shiki render with line-number scroll/highlight
- xlsx / csv files: dynamic-imported table viewer branch (sheetjs / papaparse)

Reuse `FileBrowserDrawer` — do not introduce a second drawer component.

### Acceptance criteria

- Clicking a `PathBadge` in any tool-call summary (Read/Edit/Write) opens
  the file browser drawer scrolled to the target file (and line if known).
- Free-text mentions inside assistant `MarkdownRenderer` output that exactly
  match a path from the current issue's touched-files set are rendered as
  the same clickable chip.
- Drawer open/close does not move chat input focus; `Esc` closes.
- xlsx / csv files render as a virtualized table (Sheets tabs for xlsx).
- Mobile breakpoint switches to full-screen bottom-sheet layout.
- No regression on existing FileBrowserDrawer entry points
  (`openForIssue`, `toggleDrawer`, `openFullscreen`).

## ActiveForm

Wiring clickable path chips and file preview drawer mode.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

See PLAN-011 for investigation findings and proposed implementation.

### Completion notes (2026-05-11)

- All seven proposal steps implemented and wired end-to-end.
- 20 new tests added across `path-chips.test.tsx` and
  `file-browser-store-openAt.test.ts`; total frontend suite stays green at
  137/137 (+20 vs baseline 117).
- `AssistantCopy.test.tsx` updated to wrap renders in
  `QueryClientProvider` + `MemoryRouter` since `AssistantMessage` now
  reads `useIssueChanges` via `useFilePreview`.
- New deps: `papaparse@5.5.2` (csv, eager) and `xlsx@0.20.3` (SheetJS
  community tarball, dynamic-imported only when xlsx files are previewed).
  Both MIT-licensed.
- Lint clean on every touched file; pre-existing repo-wide lint debt
  (~69 errors in unrelated files) left untouched per scope.

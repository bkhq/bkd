# 20261013-0726-workspace-side-panel Merge the diff and file panels into one tabbed workspace side panel

- **status**: in_progress
- **priority**: P2
- **owner**: cd
- **createdAt**: 2026-10-13 07:26

## Description

On the issue detail and review pages, the diff panel and the inline file
browser are two independent side panels with separate widths and toggles.
Replace them with one right-side workspace panel (frontend only):

- Two tabs: Files and Review. Each tab can be closed; closing the last tab
  hides the panel.
- A show-panel button at the top-right of the chat title bar while the panel
  is hidden; once open, the hide button sits at the panel's top-right, next to
  a maximize button that overlays the chat area, leaving a strip of the chat
  visible and the issue list in place. The panel
  starts with no tabs and then shows a launcher (open files / open review);
  hiding it leaves maximize.
- The status-bar folder button and changed-files pill open their tab.
- Tabs show counts: Review the changed-file count, Files the entry count of
  the current directory.
- The panel is hidden by default; mobile keeps a full-screen overlay.

Out of scope (later phase): per-turn diff, commit/push, built-in browser,
terminal tab, keyboard shortcuts.

Acceptance: store tests cover open/close/toggle semantics; both pages render
one panel with a single width; `bun run check` passes.

## ActiveForm

Building the tabbed workspace side panel.

## Dependencies

- **blocked by**: PR #147 (branched from `feat/chat-turn-navigator-worktree-cleanup`)
- **blocks**: (none)

## Notes

- Review tab gained a toolbar (totals, stacked/split, wrap, expand/collapse
  all). Diffs render inside `@pierre/diffs`' `Virtualizer` (visible lines only)
  with highlighting in its worker pool; Vite builds the worker as ES with the
  slim-shiki plugin. Whitespace-only filtering needs backend `git diff -w` and
  is deferred.
- Review toolbar: jump-to-file search and a changed-file tree (filter, status
  letters, click to reveal). Files tab: a lazily loaded directory tree that
  opens files directly (`FileTree`, shared `TreeRow`, `lib/path-tree`).
- Files tab rewritten: tree open by default, files directly editable with a
  compact header (modified + save, file menu). Saves are conflict-safe:
  `PUT /files/.../save` takes `expectedModifiedAt` and answers 409 when the file
  changed on disk; the editor offers reload or overwrite, and listings refresh
  on `changes-summary`.

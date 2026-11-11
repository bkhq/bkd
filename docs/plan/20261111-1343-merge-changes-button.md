# 20261111-1343-merge-changes-button One changes button in the chat input; drop the old diff panel

- **status**: completed
- **createdAt**: 2026-11-11 13:43
- **approvedAt**: 2026-11-11 13:43
- **relatedTask**: 20261111-1343-merge-changes-button

## Context

- `ChatInput` status bar: folder button -> `useFileBrowserStore.toggleDrawer(projectId, issueId)`; stats button ->
  `onToggleDiff` (issue page: `togglePanel` of the workspace panel; board `IssuePanel`: its lazy `DiffPanel`).
- `DiffPanel` is the last user of `ChangesTree`, `TreePane`, `TreeRow`, `tree-pane-store`, `diff-view-store`,
  `lib/path-tree`, `useIssueFilePatch` / `kanbanApi.getIssueFilePatch` and the `@pierre/diffs` worker import.
- The backend `GET .../changes/file` route is a documented API and stays.

## Proposal

1. `ChatInput`: one button, folder icon + "N files changed +a -d", opens the drawer; drop `diffOpen` / `onToggleDiff`.
2. `ChatBody` / `ChatArea` / `IssuePanel`: drop `showDiff` / `onToggleDiff`; `IssuePanel` loses its `DiffPanel`.
3. Delete: DiffPanel.tsx, ChangesTree.tsx, files/TreePane.tsx, files/TreeRow.tsx, stores/diff-view-store.ts,
   stores/tree-pane-store.ts, lib/path-tree.ts, their tests (diff-changes-mobile, tree-pane, diff-view-store,
   tree-pane-store, path-tree), `useIssueFilePatch`, `queryKeys.issueFilePatch`, `kanbanApi.getIssueFilePatch` and
   the `IssueFilePatchResponse` re-export in `types/kanban.ts`.
4. i18n (en + zh): drop every `diff.*` key except `diff.openFiles`, and `fileBrowser.copyPath`,
   `copyRelativePath`, `pathCopied`, `resizeTree`. (`diff.emptyFile`, `fileBrowser.copyPath` and
   `copyRelativePath` were already unused.)
5. Tests: ChatInput shows one files button with the stats that opens the drawer.

## Risks

- Persisted localStorage keys of the two deleted stores are left behind in browsers (harmless).
- `vite.config.ts` keeps its `worker` block (ES worker output); no worker remains after this, but build config is
  left untouched.

## Scope

~25 files, mostly deletions (~1300 lines).

## Alternatives

- B: merge only the look; the board keeps the old diff (rejected by the user).

## Annotations

User chose A on 2026-11-11.

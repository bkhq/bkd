# 20261105-1053-adopt-filemanager Replace the file browser with bkhq/filemanager

- **status**: completed
- **createdAt**: 2026-11-05 10:53
- **approvedAt**: 2026-11-05 10:53
- **relatedTask**: 20261105-1053-adopt-filemanager

## Context

- `bkhq/filemanager` (MIT, shadcn registry, upstream `8d95a43`) ships `fm-core`, `fm-server`
  (`createFmRouter`), `fm-driver-local`, `fm-client`, `fm-react` (`<FileManager />`) and
  plugins. Its architecture doc plans exactly this migration for bkd.
- BKD consumers of the current browser: `FileBrowserDrawer`, `WorkspacePanel` (Files tab),
  `file-browser-store` (opened from `KanbanHeader`, `IssueListPanel`, `ChatInput`);
  `SkillsPage` reuses `FileEditor` / `CodeEditor` / `TreeRow` / `MarkdownRenderer`.

## Decisions (user, 2026-11-05)

1. Copied fm sources keep upstream formatting; ESLint ignores `src/fm/**`
   (docs/decisions/2026-11-05-filemanager-vendored-style.md).
2. `/api/fm` uses fm's `hono-openapi` routes and stays out of BKD's OpenAPI document
   (docs/decisions/2026-11-05-filemanager-openapi-exception.md).
3. Trash (`/.fm-trash`) and upload sessions (`/.fm-uploads`) are redirected to
   `data/fm/<root-hash>/` by a BKD driver wrapper; nothing is written into projects.
4. The Review tab (DiffPanel) is untouched.

## Proposal

1. Vendor: `apps/api/src/fm/{core,server,drivers/local}`,
   `apps/frontend/src/fm/{core,client,react,plugins/markdown}`; missing shadcn primitives
   from upstream `apps/fm-web`; deps `hono-openapi`, `react-resizable-panels`,
   `react-dropzone`, `@streamdown/code`.
2. API `/api/fm/:projectId`: mounts `project` (project directory, SEC-007 workspace check)
   and `wt-<issueId>` (existing worktrees); `localDriver({ gitIgnore: true, uploadDir })`
   wrapped to keep hidden folders in `data/fm`; `trash: { retentionDays: 7 }`;
   `trash-cleanup` purges those trashes and the legacy `data/trash/files`. fm `read`
   keeps its own CSP plus `frame-ancestors 'self'`. `onEvent` → SSE so open views refresh.
3. UI: `<FileManager />` keyed by project + issue, labels from the i18n language,
   markdown plugin; drawer keeps its SidePanel actions; store keeps only context state.
4. Remove `routes/files.ts` and the replaced `components/files/*`, API client and hooks.

## Verification

- API tests for mounts, SEC-007, hidden-folder redirection, trash purge, CSP of `read`.
- Frontend tests for the drawer / panel wiring.
- `bun run check`; a browser smoke run (Playwright container) against the dev server.

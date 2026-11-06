# 20261106-0745-filemanager-rollout Roll bkhq/filemanager out across BKD's file UI

- **status**: completed
- **createdAt**: 2026-11-06 07:45
- **approvedAt**: 2026-11-06 07:45
- **relatedTask**: 20261106-0745-filemanager-rollout

Merged from the plans `20261106-0233-react-dropzone-uploads`, `20261106-0540-fm-review-plugin` and
`20261106-0659-skills-page-fm` (each approved and completed on its own; detail files removed).

## Context

- The vendored fm (`apps/api/src/fm/`, `apps/frontend/src/fm/`) brings `react-dropzone`, per-mount `readOnly`, a
  symlink-safe local driver, `gitChanges` review, the Markdown / review plugins, `sidebar.hidden` and `features`
  switches, and a client `fetch` override. `routes/fm.ts` `workspaceDriver()` keeps `/.fm-trash` and
  `/.fm-uploads` under `data/fm/<hash>/`.
- Before this work: hand-written drag/drop and hidden inputs in `use-file-attachments.ts` and the skill upload
  dialog; a separate Review tab built on `DiffPanel`; the Skills page had its own tree and editor over
  `GET /api/skills/:location/:name/files` and `GET|PUT …/file` (text only, 1 MB, 500 files).

## Proposal

1. Uploads: `useDropzone({ onDrop: addFiles, noClick: true, noKeyboard: true })` in `use-file-attachments.ts`
   (cumulative limits stay in `addFiles`; paste unchanged); the skill upload dialog uses `useDropzone` with
   `accept` for `.zip/.skill/.md`, `multiple: false`.
2. Registry: `@bkhq` in both `components.json`; sync by writing registry contents to their targets (or
   `shadcn add`, then revert its rewrites of `components/ui/*` and dependency ranges).
3. Review: `workspaceDriver()` turns on `gitChanges`; `WorkspaceFiles` loads `reviewPlugin()`; the workspace panel
   is one file manager (no tabs, both chat-input buttons toggle it).
4. Skills: `workspaceDriver(root, { git })`; `routes/skills-fm.ts` serves one mount per skill
   (`<location>~<name>`, realpath root, `readOnly` when managed or when `assertProjectScope` refuses the
   project); `app.ts` extends `isFmContentPath` and the raw-PUT check to `/api/skills/fm/`; the frontend
   `SkillFiles` hides every other mount in the sidebar and reloads the skill list after a change. Remove the old
   skill file routes, schemas, service functions, shared types, hooks, API client functions, and the editor
   components only they used (`FileEditor`, `CodeEditor`, `MarkdownRenderer`, `IconButton`).

## Risks

- The skills security boundary moved from `resolveInside` / `assertEditable` to the fm jail and read-only mounts;
  covered by `api-skills-fm.test.ts` (read-only refusal checked by a mutation run).
- Removing the skill file endpoints changes the REST contract; no in-repo or `bkd` skill consumer.
- Single-file deletes go to fm trash (`data/fm/<hash>/`), whole skills to `data/trash/skills/`.
- `gitChanges` runs `git` per changes query while the review is shown.
- A `shadcn add` rewrites `components/ui/*` and dependency ranges; check after every run.

## Scope

`apps/frontend`: `use-file-attachments`, `ChatInput`, `CreateIssueDialog`, `SkillOperations`, `WorkspacePanel`,
`WorkspaceFiles`, `workspace-panel-store`, `SkillsPage`, new `SkillFiles`, `use-skills`, `kanban-api`, i18n, the
vendored `fm/`, tests. `apps/api`: `routes/fm.ts`, new `routes/skills-fm.ts`, `app.ts`, `routes/skills.ts`,
`openapi/*`, `skills/service.ts`, tests. `packages/shared`.

## Alternatives

- Skill mounts on `/api/fm/:projectId`: mixes project and skill access rules and needs a project for global skills.
- Keep the Review tab beside the file manager: two review UIs for the same diff.

## Annotations

- The eleven `@codemirror/lang-*` packages only the removed `CodeEditor` imported were dropped from
  `apps/frontend/package.json`; `@codemirror/language-data` depends on them itself and loads them on demand.

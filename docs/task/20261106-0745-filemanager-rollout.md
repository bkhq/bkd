# 20261106-0745-filemanager-rollout Roll bkhq/filemanager out across BKD's file UI

- **status**: completed
- **priority**: P1
- **owner**: claude/skills-fm
- **createdAt**: 2026-11-06 07:45

## Description

Follow-up work on this branch after `20261105-1053-adopt-filemanager`, merged from seven tasks (see Notes):

1. Uploads: the app's own drop zones (`use-file-attachments` for chat and issue creation, the skill upload dialog)
   use `react-dropzone`, as the file manager does.
2. Registry: both workspaces declare the `@bkhq` registry; the vendored fm sources are synced from it.
3. Review: project and worktree mounts run the local driver with `gitChanges`; the issue chat's right panel is one
   file manager (Changes section, diffs on open, "Review all changes") with no tab bar.
4. Skills page: a skill's files open in the file manager at `/api/skills/fm/:projectId`, one mount per skill;
   managed skills are read-only mounts. The old skill file routes and editor components are removed.

Acceptance: drop / pick / paste attach as before; fm sources match the registry; the workspace panel shows changes
and diffs; skill files are browsable and editable (read-only when managed) with only the open skill in the tree;
`bun run check` passes.

## ActiveForm

Rolling the file manager out across BKD

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261106-0745-filemanager-rollout](../plan/20261106-0745-filemanager-rollout.md)

Merged tasks (detail files removed; history in `docs/changelog.md`):

- `20261106-0233-react-dropzone-uploads` — completed (part 1).
- `20261106-0250-fm-failing-tests` — closed: two fm API failures were Bun 1.4.0 bugs, fixed in 1.4.2. The local
  install `/srv/bkd/lode.toml` was moved to Bun 1.4.4; agents inherit BKD's runtime first on `PATH`.
- `20261106-0310-update-filemanager` — completed (part 2).
- `20261106-0540-fm-review-plugin` — completed (part 3, step 1: `gitChanges` + `fm-plugin-review`).
- `20261106-0620-review-tab-fm` — completed, then superseded by `0640` (Review tab removed).
- `20261106-0640-single-workspace-panel` — completed (part 3). The kanban `IssuePanel` keeps `DiffPanel`.
- `20261106-0659-skills-page-fm` — completed (part 4), plus follow-ups: the skill tree shows only the open skill
  (`sidebar.hidden`), and fm synced to upstream `37a643e` (menu separator fix, Manage drives hidden with one drive).

Open, kept separate: `20261106-0600-dev-hot-reload-pid-lock`.

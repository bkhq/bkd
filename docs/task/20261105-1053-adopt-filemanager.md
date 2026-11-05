# 20261105-1053-adopt-filemanager Replace the file browser with bkhq/filemanager

- **status**: completed
- **priority**: P1
- **owner**: main
- **createdAt**: 2026-11-05 10:53

## Description

Swap BKD's own file browser (`routes/files.ts`, `components/files/*`) for the
`bkhq/filemanager` registry: `createFmRouter` + `localDriver` on the API, `<FileManager />`
in the drawer and the issue workspace panel. Trash and upload state live under `data/`,
never in the project directory. The Review tab stays as is.

## ActiveForm

Replacing the file browser with bkhq/filemanager

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261105-1053-adopt-filemanager.md

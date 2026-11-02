# 20261102-1023-file-browser-polish File browser fixes, recoverable delete, create/rename, quick open, virtual tree

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-11-02 10:23

## Description

Polish the workspace file browser and close its main gaps: list dates as concrete
times, cheaper file reads and listings, raw-file revalidation, deletes that can be
recovered, create file/folder and rename, quick open by file name, and a virtualized
tree for large directories.

## ActiveForm

Polishing the workspace file browser

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261102-1023-file-browser-polish.md
- complete: bun run check passed (1011 API, 418 frontend tests). Not verified in a real browser (none in the container).
- Tree rows are a fixed 24px (no measuring): jsdom measures 0 and loops, and every row is one text-xs line.

# 20261111-1343-merge-changes-button One changes button in the chat input; drop the old diff panel

- **status**: completed
- **priority**: P2
- **owner**: claude/session-bkd
- **createdAt**: 2026-11-11 13:43

## Description

The chat input shows two buttons that now open the same thing: a folder button (file browser drawer) and
"N files changed" (workspace panel on the issue page, the old `DiffPanel` in the board's issue panel). Review lives in
the file manager now, so keep one button (folder icon + change stats) that opens the file browser drawer everywhere,
and delete the old diff view, which loses its last entry point.

## ActiveForm

Merging the chat input's file buttons and removing the old diff panel

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261111-1343-merge-changes-button](../plan/20261111-1343-merge-changes-button.md)

- complete: Implemented; bun run check passes

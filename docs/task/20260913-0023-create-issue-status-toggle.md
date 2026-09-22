# 20260913-0023-create-issue-status-toggle Replace the create-issue status dropdown with a toggle

- **status**: completed
- **priority**: P2
- **owner**: claude/session-main
- **createdAt**: 2026-09-13 00:23

## Description

The create-issue dialog exposes all four board statuses (`todo`, `working`,
`review`, `done`) through a dropdown, but only two outcomes are meaningful at
creation time: queue the issue (`todo`) or create it and start executing
(`working`; the server maps `review` to `working` and executes as well).

Replace the dropdown with a switch-style control matching the worktree row, so
the field reads as a binary choice instead of a four-option menu. Incoming
`initialStatusId` from a board column must be folded onto the two states.

Acceptance criteria:

- The status property row renders a switch plus the current status name, not a dropdown.
- Off = `todo`, on = `working`; the created issue starts executing only when on.
- Opening the dialog from the `review` column preselects on; `todo`/`done` preselect off.
- No new i18n keys needed beyond existing `statusName.*`; both locales stay in sync.

## ActiveForm

Replacing the create-issue status dropdown with a toggle

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

- complete: Switch replaces the status dropdown; column status folded onto todo/working

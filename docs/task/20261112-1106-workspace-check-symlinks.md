# 20261112-1106-workspace-check-symlinks Resolve symlinks in the workspace boundary check

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-11-12 11:06

## Description

`isInsideWorkspace()` (`apps/api/src/utils/workspace.ts`) compares resolved path strings. A project directory that
is, or sits below, a symlink pointing outside `workspace:defaultPath` passes the check (SEC-016 / SEC-030 call
sites: execute, auto-execute, cron `issue-execute`, `git/detect-remote`, file manager mounts). The behaviour predates
the helper, which only gathered the copies; `routes/filesystem.ts` already verifies real paths with its own helper.

Compare real paths on both sides (nearest existing ancestor for a directory that does not exist yet), and decide
what happens to existing projects whose directory is a symlink into another location.

Acceptance: a test with a symlink inside the workspace pointing outside it is refused at each call site; projects
with ordinary directories are unaffected.

## ActiveForm

Making the workspace boundary check symlink-aware

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Reported by an automated security review of the dedupe change (20261111-1734-dedupe-redundant-code).

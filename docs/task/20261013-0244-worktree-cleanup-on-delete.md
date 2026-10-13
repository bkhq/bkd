# 20261013-0244-worktree-cleanup-on-delete Clean up worktrees of deleted issues and stop cleanup stats from timing out

- **status**: completed
- **priority**: P1
- **owner**: cd/worktree-cleanup
- **createdAt**: 2026-10-13 02:44

## Description

Worktrees of deleted issues and projects are never removed, and the cleanup
stats endpoint times out once they pile up.

- Deleting a project or an issue only sets `isDeleted = 1`; the worktree under
  `WORKTREE_BASE/<projectId>/<issueId>` stays on disk.
- The `worktree-cleanup` cron action only removes worktrees of `done` issues
  with `isDeleted = 0`, so deleted issues are never picked up.
- Manual cleanup (`POST /api/settings/cleanup`, `worktrees`) calls
  `removeWorktree(process.cwd(), ...)`, so `git worktree remove` runs in the
  wrong repo, falls back to `rm`, and leaves stale entries in the project's
  `.git/worktrees/`.
- `GET /api/settings/cleanup/stats` walks every orphaned worktree file by file
  (`getDirSize`, serial `readdir` + `stat`). With `node_modules` in a few
  worktrees this exceeds the frontend's 30s request timeout
  (`ERR_CONNECTION_CLOSED` on a deployed instance).

Acceptance criteria:

- With `worktree:autoCleanup` on, worktrees of issues deleted for more than
  1 day are removed; restore within the window keeps the worktree intact.
- Hard-deleting issues (cleanup "deleted issues") removes their worktrees.
- Manual worktree cleanup runs `git worktree remove` in the owning project's
  repository.
- Cleanup stats return without walking worktree contents.
- Tests cover each behaviour; `bun run check` passes.

## ActiveForm

Cleaning up worktrees of deleted issues.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261013-0244-worktree-cleanup-on-delete.md`.

- complete: worktree-cleanup.test.ts 6/6 (RED 4 before the fix); api + frontend typecheck pass; eslint clean on changed files and on 'eslint . --ignore-pattern data/**'. Full test:api failures are pre-existing and identical on a clean tree (see follow-up tasks).

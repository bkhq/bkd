# 20261013-0244-worktree-cleanup-on-delete Clean up worktrees of deleted issues and stop cleanup stats from timing out

- **status**: completed
- **createdAt**: 2026-10-13 02:44
- **approvedAt**: 2026-10-13 03:17
- **relatedTask**: 20261013-0244-worktree-cleanup-on-delete

## Context

Worktree layout: `WORKTREE_BASE/<projectId>/<issueId>` on branch
`bkd/<issueId>` (`engines/issue/utils/worktree.ts`). `removeWorktree(baseDir,
path)` runs `git worktree remove --force` in `baseDir` and falls back to `rm`
inside `WORKTREE_BASE` on failure; it never deletes the branch.
`cleanupWorktree` is a fire-and-forget wrapper with no callers today.
`ensureWorktree` re-attaches an existing `bkd/<issueId>` branch when the
directory is gone.

Lifecycle gaps:

- `routes/projects.ts` `deleteProject` and `routes/issues/delete.ts` only
  soft-delete rows. Nothing touches the worktree.
- `cron/actions/builtins/worktree-cleanup.ts` (gated by `worktree:autoCleanup`,
  default off) only selects `done`, `isDeleted = 0` issues done for >= 1 day.
- `routes/settings/cleanup.ts` `cleanupWorktrees` passes `process.cwd()` as
  `baseDir`. Under lode the cwd is the per-version install dir, not a project
  repo, so `git worktree remove` fails, the directory is `rm`-ed, and the
  project's `.git/worktrees/<name>` entry stays until `git worktree prune`.
- `cleanupDeletedIssues` hard-deletes rows but leaves worktrees.
- Recycle bin (`routes/settings/recycle-bin.ts`) can restore a soft-deleted
  issue (and its project).

Stats timeout: `GET /api/settings/cleanup/stats` calls `getDirSize` on every
orphaned worktree (issue deleted or missing). It is a serial recursive
`readdir` + `stat`, one await per file. Worktrees with `node_modules`/build
output reach 10^5+ files each; the frontend aborts at
`DEFAULT_TIMEOUT_MS = 30_000` (`frontend/src/lib/kanban-api.ts`). The UI
(`AppSettingsDialog.tsx:837`) only appends the size when it is `> 0`.

## Proposal

Deleted issues keep their worktree so a recycle-bin restore is lossless; the
existing `worktree:autoCleanup` switch reclaims it after the same 1-day window
it already applies to `done` issues.

1. **Cron cleanup covers deleted issues**
   (`cron/actions/builtins/worktree-cleanup.ts`): select worktree issues that
   are either `done` for >= 1 day and not deleted (unchanged), or soft-deleted
   for >= 1 day in any status. Deletion time is `updatedAt`, which the
   soft-delete bumps (`$onUpdateFn`) and nothing writes afterwards. The
   `useWorktree` and not-`running`/`pending` guards stay. Deleting a project
   soft-deletes its issues, so it is covered; the project-directory lookup
   already includes soft-deleted projects.
2. **Hard delete removes worktrees first** (`routes/settings/cleanup.ts`
   `cleanupDeletedIssues`): before the rows go, remove each issue's worktree
   with its project's repository as `baseDir`; otherwise it becomes an orphan
   no cron run can match.
3. **Manual cleanup uses the owning repo** (`routes/settings/cleanup.ts`
   `cleanupWorktrees`): map the worktree's project dir name to
   `projects.directory` (soft-deleted projects included) instead of
   `process.cwd()`. With no project row, `removeWorktree`'s `rm` fallback still
   applies.
4. **Stats stop walking worktrees** (`routes/settings/cleanup.ts`):
   `getWorktreesStats` returns the count and `totalSize: 0`; no schema change,
   the settings dialog already hides a zero size.
5. **Hint copy**: `worktreeAutoCleanupHint` in `en.json` / `zh.json` mentions
   deleted issues.

Restore after the window re-creates the worktree from the kept `bkd/<id>`
branch through `ensureWorktree`; only uncommitted changes are lost, as for
cleaned-up `done` issues today.

Tests (RED first):

- cron: a soft-deleted worktree issue past the window is removed; one inside
  the window and a live one are kept.
- `cleanupDeletedIssues`: the worktree is removed and deregistered from the
  project repo.
- manual cleanup: an orphaned worktree is deregistered from the project repo.
- stats: `worktrees.count` is reported with `totalSize: 0`.

## Risks

- The switch is off by default; without it deleted worktrees still need
  manual cleanup (which no longer times out or leaves stale registrations).
- `updatedAt` as deletion time can only move later, delaying cleanup, never
  advancing it.
- The worktree size is no longer shown in the cleanup dialog.

## Scope

`cron/actions/builtins/worktree-cleanup.ts`, `routes/settings/cleanup.ts`,
two i18n files, new tests. No schema, migration, or API contract change.

## Alternatives

- **Remove worktrees on delete**: frees space immediately but loses
  uncommitted work on restore. Rejected: restore must stay lossless.
- **Snapshot into `bkd/<id>` before removing**: survives the window, but
  writes commits into user repos (signing, hooks, mid-merge state) and still
  loses gitignored files. Deferred.
- **Bounded size in stats** (`du -sb` with a cap): needs a schema change and
  still costs seconds on large trees.

## Annotations

(none)

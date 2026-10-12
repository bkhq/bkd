# 20261002-1111-worktree-reuse Keep worktree issues out of the main checkout

- **status**: completed
- **createdAt**: 2026-10-02 11:11
- **approvedAt**: 2026-10-02 11:11
- **relatedTask**: 20261002-1111-worktree-reuse

## Context

| Path | Worktree handling | On failure |
|---|---|---|
| `orchestration/execute.ts` | `createWorktree` unconditionally | warn, run in base dir |
| `orchestration/restart.ts` | `createWorktree` unconditionally | warn, run in base dir |
| `lifecycle/spawn.ts` `spawnRetry` | reuse if the dir exists and is registered | run in base dir |
| `lifecycle/spawn.ts` `spawnFollowUpProcess` | reuse, else create | warn, run in base dir |

- `createWorktree` runs `git worktree add -b bkd/<id> <dir> <main>` and retries
  without `-b`. With the worktree present the first fails with `a branch named
  ... already exists` and the second with `'<dir>' already exists` (reproduced
  in a scratch repo), so restart and re-execute always take the fallback.
- The fallback is silent: the user asked for isolation and the engine edits the
  main checkout. For Claude the session is keyed by cwd, so the resumed session
  is not found either.
- The worktree resolution in execute, restart and follow-up happens after the
  session is set to `running` and outside the try block that reverts it.

## Proposal

1. `utils/worktree.ts`: add `ensureWorktree(baseDir, projectId, issueId)` —
   returns the existing worktree when its directory exists and is registered
   under `baseDir`, otherwise calls `createWorktree`. Errors propagate.
2. Execute, restart, retry and follow-up call `ensureWorktree` instead of their
   own logic, with no fallback to the base directory.
3. In execute, restart and follow-up the call moves inside the existing try
   block, so a failure runs the existing revert (session `failed`, error log,
   pre-persisted follow-up message removed) before any process is spawned.

## Tests (RED first)

`test/worktree-reuse.test.ts` with a scratch git repo as the project directory
and a recording executor:

- `ensureWorktree` returns the same path on a second call; throws outside a
  git repo.
- Execute, then restart: both spawns run in the worktree.
- Execute twice: the second spawn runs in the worktree.
- Project directory that is not a git repo: execute rejects, nothing is
  spawned, the session is `failed`.

## Risks

- Behavior change: a `useWorktree` issue in a non-git project (or a repo with
  no `main`/`master`) used to run in the project directory and now fails with
  the git error. That is the intent — isolation was requested and cannot be
  given.
- A stale directory at the worktree path that git does not know about now
  fails the turn instead of falling back.

## Scope

`utils/worktree.ts`, `orchestration/execute.ts`, `orchestration/restart.ts`,
`lifecycle/spawn.ts`, one new test file, changelog. No schema or API change.

## Alternatives

- Keep the fallback but surface a warning in the chat. Rejected: the engine
  would still modify the main checkout of an issue marked as isolated.

## Annotations

(none)

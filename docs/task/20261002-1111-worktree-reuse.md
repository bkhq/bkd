# 20261002-1111-worktree-reuse Keep worktree issues out of the main checkout

- **status**: completed
- **priority**: P1
- **owner**: claude/session-audit-fixes
- **createdAt**: 2026-10-02 11:11

## Description

An issue with `useWorktree` can silently run in the project's main checkout.

1. `restartIssue` and `executeIssue` call `createWorktree` unconditionally. When
   the worktree already exists (any restart, any second execute) both
   `git worktree add` attempts fail, the error is swallowed, and the engine runs
   in the base directory.
2. Every path (execute, restart, retry, follow-up) falls back to the base
   directory when the worktree cannot be created or found, with only a warn log.

Acceptance:

- Restart and re-execute of a worktree issue run inside the existing worktree.
- When the worktree cannot be created, the turn fails with a visible error and
  no engine process is spawned; the session ends `failed`.
- Tests cover reuse on restart / re-execute and the failure path.

## ActiveForm

Keeping worktree issues inside their worktree

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261002-1111-worktree-reuse.md`. Found by the 2026-10-02 audit of the
issue-creation flow and process management.

- complete: New tests pass; lint and API typecheck pass. Full API suite: 764 pass, 1 failure in api-execution.test.ts that is the known order-dependent flake (task 20261002-1046-api-execution-concurrency-flake). Frontend tests and build not run (no frontend change).

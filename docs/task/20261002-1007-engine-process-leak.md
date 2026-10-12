# 20261002-1007-engine-process-leak Kill engine processes that fail registration or the Codex handshake

- **status**: completed
- **priority**: P0
- **owner**: claude/session-main
- **createdAt**: 2026-10-02 10:07

## Description

BKD spawns the engine process before it registers it with the process manager.
Anything that throws between the spawn and `register()` leaves the child running
with no owner: it carries out the prompt it was given, its output never reaches
BKD, and cancel cannot reach it. Present since the initial commit (`cdcaa8a`).

Two triggers:

1. Concurrency limit: `ProcessManager.register()` throws `Concurrency limit
   reached` after the child is already up. Affects execute, follow-up, retry and
   restart.
2. Codex handshake: `CodexExecutor.spawn` / `spawnFollowUp` run `initialize`,
   the auth check, `thread/start` or `thread/resume`, and `turn/start` after
   `spawnNode` with no cleanup. An orphaned Codex process keeps the thread's
   writer lock, so every later follow-up fails with `already has an active
   writer` and leaks one more process.

Acceptance:

- A full concurrency limit is detected before any process is spawned.
- If registration still fails after a spawn (another issue took the last slot
  while this one was spawning), the child is killed and the session reverts.
- A Codex handshake failure kills the child before the error propagates.
- Tests: full concurrency limit and a rejected `thread/resume` leave no child
  process alive.

## ActiveForm

Fixing leaked engine processes on spawn failure

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261002-1007-engine-process-leak.md`.

- complete: New tests pass; lint, typecheck and build pass. Full API suite: 1 failure in api-execution.test.ts that also fails on the unchanged baseline (task 20261002-1046-api-execution-concurrency-flake).

# 20261002-1007-engine-process-leak Kill engine processes that fail registration or the Codex handshake

- **status**: completed
- **createdAt**: 2026-10-02 10:07
- **approvedAt**: 2026-10-02 10:20
- **relatedTask**: 20261002-1007-engine-process-leak

## Context

Every engine path spawns first and registers second:

| Path | Spawn | Post-spawn steps that can throw | Cleanup on throw |
|---|---|---|---|
| `orchestration/execute.ts` | `executor.spawn` (:94) | `updateIssueSession` (:131), `register` (:148) | none; the try/catch covers only the spawn |
| `lifecycle/spawn.ts` `spawnRetry` | :205-210 | `register` (:215) | none, no try at all |
| `lifecycle/spawn.ts` `spawnFollowUpProcess` | :335-340 | `register` (:374) | none; the revert in the catch covers only the spawn |
| `orchestration/restart.ts` | :93-109 | `register` (:126) | none |
| `spawnFresh` / `spawnWithSessionFallback` | `executor.spawn` | `updateIssueSession(externalSessionId)` | none |

- `ProcessManager.register()` (`process-manager.ts:115`) is the only place that
  enforces `maxConcurrent`, so a full limit is discovered only after the child
  is up and the prompt is sent.
- `killExistingSubprocessForIssue` → `terminateGroup` reaches registered entries
  only, so a follow-up cannot clean an orphan up.
- `spawnNode` (`engines/spawn.ts`) starts children in their own process group;
  `Subprocess.kill()` without an argument sends SIGKILL to the whole group.
- `CodexExecutor.spawn` (:363) / `spawnFollowUp` (:427) await `initialize`, the
  auth check, `startThread` / `resumeThread` and `startTurn` after `spawnNode`
  with no try/catch. The Claude, Grok and Cursor executors only write to stdin
  after the spawn, so they are not affected in practice.
- When `register()` throws today, the session also stays `running` and the
  persisted user message stays, because the revert branch is not reached.

## Proposal

1. `ProcessManager.assertCapacity()` — throws the existing `Concurrency limit
   reached (n/max)` error. `register()` calls it instead of its inline check.
2. Check capacity before spawning: `executeIssue`, `restartIssue`, `spawnRetry`
   and `spawnFollowUpProcess` call `ctx.pm.assertCapacity()` before the executor
   is invoked (in the follow-up path, after `killExistingSubprocessForIssue`
   frees this issue's own slot). A full limit then never starts a process.
3. Kill on any post-spawn failure, because the pre-check races with other
   issues that register while this one is spawning:
   - Move the post-spawn steps (`updateIssueSession`, `register`) into the
     existing try blocks of execute and follow-up, so their revert logic
     (session `failed`, remove the pre-persisted user message, SSE `failed`)
     also runs for a registration failure; add the same in restart and retry.
   - In the catch, kill the spawned child if one exists:
     `spawned.subprocess.kill()` (SIGKILL to the process group). The child is
     unregistered, so nothing else would ever stop it.
   - `spawnFresh` / `spawnWithSessionFallback`: kill the child if the
     `externalSessionId` DB write after the spawn throws.
4. Codex executor: wrap everything after `spawnNode` in `spawn` and
   `spawnFollowUp` in try/catch; on error `handler.close()` and `proc.kill()`,
   then rethrow.

## Tests (RED first)

- `test/engine-spawn-leak.test.ts`: swap the registry's `codex` entry for a test
  executor that spawns a real `sleep` via `spawnNode` and records the pids.
  - Full limit before execute / follow-up / restart: the executor is never
    called and the issue session ends `failed`.
  - Limit filled while spawning (the test executor raises the active count
    during its spawn): `register()` throws, the recorded pid is dead, the
    session is `failed`.
- `test/codex-spawn-cleanup.test.ts`: a fake `codex` script on `PATH` answers
  `initialize` and rejects `thread/resume` with `already has an active writer`,
  writes its pid to a file and ignores stdin EOF. After `spawnFollowUp` rejects,
  the pid is dead.

## Risks

- SIGKILL gives the engine no chance to save its session. Acceptable: the
  process is unowned and its output is discarded anyway; for Codex this is what
  releases the thread writer lock.
- The capacity pre-check moves the failure earlier: callers see the same error
  message, before the user prompt reaches the engine. The follow-up revert
  path already handles a throw there.
- The Codex test depends on `PATH` resolution and is skipped when
  `/work/bin/codex` exists (that location wins over `PATH`).

## Scope

`process-manager.ts`, `issue/orchestration/execute.ts`,
`issue/orchestration/restart.ts`, `issue/lifecycle/spawn.ts`,
`executors/codex/executor.ts`, two new test files, changelog. No schema, API or
frontend change. The orphans already running on the host are not handled by
this change; they need a manual kill (or a BKD restart) once.

## Alternatives

- Reserve a slot in `ProcessManager` before the spawn and release it on failure.
  Closes the race fully, but adds a reservation state to every path and to
  `activeCount()`. The pre-check plus kill-on-failure gives the same outcome
  (no process outlives a failed registration) with less machinery.
- Kill only, no pre-check: simpler, but every limit hit would still start a
  process and send the prompt before killing it.

## Annotations

(none)

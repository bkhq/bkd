# 20261125-2209-codex-models-spawn-error Skip the Codex model query when Codex is not installed, and report spawn failures

- **status**: completed
- **createdAt**: 2026-11-25 22:09
- **approvedAt**: 2026-11-25 22:27
- **relatedTask**: 20261125-2209-codex-models-spawn-error

## Context

- `startup-probe.ts` `runLiveProbe()` calls `getAvailability()` and `getModels()` of every
  executor in parallel, installed or not.
- claude, grok and cursor `getModels()` return early (or fallback models) when their binary
  is missing. codex `getModels()` → `queryCodexModels()` → `resolveBaseCmd()`, which falls
  back to `npx -y @openai/codex` (`NPX_FALLBACK`), so an uninstalled Codex still spawns.
- `spawnNode()` (`engines/spawn.ts`) wraps `node:child_process.spawn`. Verified under Bun:
  for a missing executable `child.pid` is `undefined` and `child.stdout.destroyed` is `true`
  synchronously; `Readable.toWeb()` on it rejects reads with
  `AbortError: The operation was aborted`; the `ENOENT` (`Executable not found in $PATH: "x"`)
  arrives later on the child's `error` event, surfaced only through `exited`.
- `JsonRpcSession` reads stdout first, so `codex_models_error` logs the AbortError.
- 14 `spawnNode()` call sites (engine executors, `cli-update.ts`, `skills/cli.ts`) share
  the same masking.

## Proposal

1. `engines/executors/codex/executor.ts` — `getModels()`: `const binary = resolveBinaryOnly();
   if (!binary) return []`, and pass `binary` to `queryCodexModels(binary)` instead of
   `resolveBaseCmd()`. Execution paths keep the npx fallback.
2. `engines/spawn.ts` — in `spawnNode()`, when `child.pid === undefined` (spawn failed),
   build stdout/stderr as web streams that error with the child's `error` event instead of
   calling `Readable.toWeb()`:

   ```ts
   const spawnError = child.pid === undefined
     ? new Promise<Error>(resolve => child.once('error', resolve))
     : null
   const toWeb = (r: Readable | null) =>
     spawnError ? erroredStream(spawnError) : r ? nodeReadableToWebStream(r) : emptyReadableStream()
   ```

   `erroredStream` awaits the promise in `start()` and calls `controller.error(err)`.
   `exited` is unchanged (still rejects with the same error).
3. Tests (RED first):
   - `test/spawn-node-error.test.ts`: `spawnNode(['bkd-no-such-binary'])` → reading stdout
     rejects with a message containing `bkd-no-such-binary`; `exited` rejects.
   - Codex: with `PATH` / `HOME` pointed at an empty dir, `getModels()` returns `[]` and
     spawns nothing (check via a mocked `spawnNode`, or added to an existing codex test).

## Risks

- Callers that matched on `AbortError` for failed spawns: none found (`grep AbortError`
  will be re-checked before implementation).
- `child.pid === undefined` is the documented Node signal for a failed spawn; Bun matches it
  (verified). If a runtime emitted `error` without that, behaviour falls back to today's.
- Codex models list stays empty when Codex is only reachable through npx — same result as
  today when npx works only after a slow download; `getAvailability()` already reports such
  a setup as not installed.

## Scope

`apps/api/src/engines/spawn.ts`, `apps/api/src/engines/executors/codex/executor.ts`, two
test files. No API, schema or frontend change.

## Alternatives

- Throw synchronously from `spawnNode()` on a failed spawn: clearer, but changes control
  flow at all 14 call sites (some expect a handle to register/clean up). Rejected.
- Fix only `queryCodexModels()` by racing `exited`: leaves the misleading error everywhere
  else. Rejected.

## Annotations

(none)

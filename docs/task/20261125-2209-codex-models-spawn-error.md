# 20261125-2209-codex-models-spawn-error Skip the Codex model query when Codex is not installed, and report spawn failures

- **status**: completed
- **priority**: P2
- **owner**: claude/bkd-codex-models
- **createdAt**: 2026-11-25 22:09

## Description

A launchd-supervised BKD on macOS logs `codex_get_models_failed: The operation was aborted`
on every engine probe. Two causes:

1. `CodexExecutor.getModels()` spawns `npx -y @openai/codex app-server` when no `codex`
   binary is found; every other executor returns early when its binary is missing. With no
   `npx` on PATH the spawn fails.
2. `spawnNode()` hides spawn failures: Bun destroys the child's stdio synchronously when the
   executable cannot be started, `Readable.toWeb()` turns that into `AbortError`, and the
   real `ENOENT` only reaches `exited`, which readers never see first.

Acceptance:

- `getModels()` returns `[]` without spawning anything when `resolveBinaryOnly()` is null.
- Reading stdout/stderr of a `spawnNode()` process whose executable cannot be started fails
  with the spawn error (message names the missing executable), not `AbortError`.

## ActiveForm

Fixing the Codex model probe and spawn error reporting

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261125-2209-codex-models-spawn-error.md

- complete: getModels() skips Codex when not installed; spawnNode() fails stdio reads with the spawn error. Tests: test/spawn-node-error.test.ts, test/codex-models-not-installed.test.ts

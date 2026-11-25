# 20261125-0752-models-no-live-probe Serve engine models from stored probe results instead of spawning the CLI

- **status**: completed
- **priority**: P1
- **owner**: claude/session-0752
- **createdAt**: 2026-11-25 07:52

## Problem

`getDetectedEngineModels()` falls back to `engineRegistry.getModels()` when the 10-minute memory cache has expired,
skipping the stored probe results. For `claude-code` that spawns `claude -p --input-format stream-json`. Every
execute, follow-up and restart resolves the model twice (`resolveExecutionModel()` and `resolveModelEnvVars()`), so
after an idle period each run launches extra `claude` processes next to the real one, with no deduplication. They
share `~/.claude/.credentials.json` and race the rotating OAuth refresh token, which logs the CLI out.

## Scope

- `apps/api/src/engines/startup-probe.ts`: on a memory-cache miss, `getDetectedEngineModels()` reads models through
  `getEngineDiscovery()` (memory → DB → deduplicated live probe).
- Regression test in `apps/api/test/startup-probe.test.ts`: with stored probe results and a cold memory cache,
  resolving models does not call the executor's `getModels()`.

## Verification

- `bun run check`.

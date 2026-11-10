# 20261110-1217-agent-cli-update Update agent CLIs (claude, codex) from Settings

- **status**: completed
- **createdAt**: 2026-11-10 12:17
- **approvedAt**: 2026-11-10 12:18
- **relatedTask**: 20261110-1217-agent-cli-update

## Context

- Engine discovery (`engines/startup-probe.ts`) caches each engine's `version` in memory and in `appSettings`
  with no expiry. A full probe also runs `claude auth status`, which touches the rotating OAuth credential, so it
  runs only on demand (ENG-035).
- Binaries resolve via each executor's `resolveBinaryOnly()` (`/work/bin`, PATH, `~/.local/bin`, ...). On this
  host both are native installs under `~/.local/bin` (`claude` -> `~/.local/share/claude/versions/<v>`,
  `codex` -> `~/.codex/packages/standalone/current`).
- Both CLIs ship an updater: `claude update` (native install, or "through the package manager" for npm/brew
  installs) and `codex update`. Grok and Cursor are out of scope.
- `skills/cli.ts` already has the pattern this needs: one operation at a time, argv-only spawn, output lines kept on
  an operation object, timeout, cancel, UI polls `GET .../operations/:id`.

## Proposal

API
- `EngineExecutor` gains an optional `updateCommand?(): string[] | null` (claude: `[bin, 'update']`, codex:
  `[bin, 'update']`; null when the binary is not found).
- `engines/cli-update.ts`: runs one update at a time (409 while busy), keeps the last output lines, 10-minute
  timeout, no cancel (an interrupted self-update can leave a half-swapped binary). After exit, re-runs only
  `<bin> --version` and patches that engine's `version` in the discovery cache (memory + DB); no full probe, so no
  auth touch.
- Routes (OpenAPI, shared Zod schemas): `POST /api/engines/:engineType/update` -> operation; `GET
  /api/engines/updates/:id` -> `{ id, engineType, status: running|succeeded|failed, output[], fromVersion,
  toVersion, exitCode }`.
- Running sessions are not touched: claude spawns per turn, so the next turn uses the new binary; a live codex
  app-server keeps the old one until it restarts. The UI says so.

Frontend
- `EngineCard`: an "Update" button for engines whose discovery entry has `updatable: true`; opens a small dialog with
  live output (polling), then shows "v1 -> v2" or the error; invalidates engine availability on finish.
- i18n keys in `en.json` and `zh.json`; shared types in `@bkd/shared`.

Tests: route tests with the runner replaced (as `setSkillsCliRunner` does): busy 409, unknown/unsupported engine
404/400, success patches the cached version, failure keeps it. Frontend test for the button and result state.

## Risks

- The updater runs as the BKD user and rewrites the CLI install; if BKD runs as a different user than the one that
  installed the CLI, it fails (reported as output, nothing to clean up).
- npm/brew installs: `claude update` delegates to the package manager, which may need permissions BKD lacks.
- Not exposed to the network beyond the existing BKD auth model; same trust level as the terminal route.

## Scope

~8 files: executor interface + 2 executors, new `cli-update.ts`, routes/openapi, shared types, `AppSettingsDialog`
(EngineCard), i18n x2, tests.

## Alternatives

- Reuse "probe engines" after update: simpler, but triggers `claude auth status` (ENG-035) - rejected.
- Scheduled auto-update (cron action): not asked for; can be added later on top of the same runner.
- Run it in the BKD terminal: no code, but no feedback in Settings.

## Annotations

(none)

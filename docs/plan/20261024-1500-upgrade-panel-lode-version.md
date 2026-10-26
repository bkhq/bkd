# 20261024-1500-upgrade-panel-lode-version Show the lode version and simplify the upgrade panel

- **status**: completed
- **createdAt**: 2026-10-24 15:00
- **approvedAt**: 2026-10-24 16:10
- **relatedTask**: 20261024-1500-upgrade-panel-lode-version

## Context

- `UpgradeSection` in `apps/frontend/src/components/AppSettingsDialog.tsx` renders a raw
  `status` badge, `lastError` ("Last attempt failed: …"), `checkError` and a 30 s check
  timeout note, then Update (only when `hasUpdate` or busy), Check, Rollback, Restart.
- lode gives its child `LODE_ACTIVE_VERSION`, `LODE_DIR`, `LODE_INSTANCE`, `LODE_WORKDIR`,
  `LODE_CONFIG` (`crates/lode-supervisor/src/launch.rs`); neither the env nor
  `state.json` carries lode's own version. The vendored SDK has no accessor for it.
- lode v0.3.0 (dab0ed9, 2026-10-24) exposes its build info to the app: env
  `LODE_VERSION`, `LODE_COMMIT` (absent when unknown), `LODE_FEATURES`, and the same in
  `state.json` `lode`. The upstream TS SDK adds `lodeVersion()`, `lodeCommit()`,
  `lodeFeatures()`, `hasFeature()`, `State.lode` (plus `resources` since v0.1.0).

## Proposal

1. lode version: re-vendor `sdks/lode.ts` from lode `v0.3.0` verbatim into
   `upgrade/lode-sdk.ts`. `getVersionInfo()` adds `lode: { version, commit } | null`
   from `lodeVersion()` / `lodeCommit()` (shared type + OpenAPI schema). The upgrade panel
   and the About tab show `lode vX.Y.Z` (commit as tooltip) instead of the bare `lode` /
   supervised badge; a lode older than 0.3.0 keeps the bare badge.
2. Panel states: drop the status badge, the `lastError` / `checkError` / timeout notes and
   their i18n keys. Keep: "new version available" + Update, or "up to date" (no Update);
   the transient "updating" spinner while lode installs; Check, Rollback, Restart; stale
   tab reload hint; last checked time.

## Risks

- A real install failure (`status: error`) is no longer shown; the user sees "up to
  date" or "available" and can retry or roll back. Details stay in lode's logs.
- Servers on lode < 0.3.0 show no lode version until lode is upgraded.

## Scope

BKD: `upgrade/service.ts`, `packages/shared`, `openapi/extra-schemas.ts`,
`AppSettingsDialog.tsx`, `en.json`, `zh.json`, tests. No lode change.

## Alternatives

- Read `state.json` `lode` instead of the env: same data, but needs a file read per
  request; the env is fixed for the process, which is what launched it.

## Annotations

- 2026-10-24: approved; hiding a real install failure (status error) is accepted.

---
id: UPGRADE-002
title: Apply a locally-installed app package via the graceful drain path
status: completed
priority: P1
owner: claude
created: 2026-05-20
relatedPlan: null
---

# UPGRADE-002 — Apply a local app package (smooth restart)

## Problem

The graceful drain from [UPGRADE-001](UPGRADE-001.md) is only reachable via
`applyUpgradeAndRestart()` → `POST /upgrade/restart`, which requires a
*downloaded* package: `getDownloadStatus()` must be `verified`/`completed`,
and downloads only accept GitHub URLs for the hardcoded `bkhq/bkd` repo.

A locally-built package (`bun run package`, e.g. `v0.0.163-lc`) never goes
through the download flow, so it has no download status and cannot reach the
drain path — the only way to activate it was a non-graceful `kill`.

## Approach (option B)

Add a second door onto the *same* drain channel — no new drain logic.
`applyLocalVersion()` skips the GitHub download/checksum gate and activates a
package already present under `data/app/v{version}/`. Package mode only
(`bun run dev` has no launcher to re-spawn).

## Changes

- `upgrade/apply.ts`
  - Factored the shared shutdown/respawn tail into `shutdownAndRespawn()`
    (used by both upgrade branches and the new local path).
  - `listLocalAppVersions()` — scans `data/app/v*` for dirs with a runnable
    `server.js`, flags the active one from `version.json`.
  - `applyLocalVersion(version)` — validates package mode + version + that
    `server.js` exists, writes `version.json`, then drains and re-spawns via
    `shutdownAndRespawn()`. Reuses the `isApplying` lock, the safety timer and
    the `setDraining(false)` reset in `finally`.
- `upgrade/utils.ts` — `VALID_VERSION_RE` (bare SemVer, rejects separators).
- `routes/settings/upgrade.ts` — `GET /upgrade/local-versions`,
  `POST /upgrade/apply-local` (Zod-validated version).
- Frontend — `useLocalVersions` / `useApplyLocalVersion` hooks (shared
  `pollServerBackAndReload` helper), `LocalVersionsPanel` in the upgrade
  settings tab (package mode only), i18n keys.

## Acceptance

- In package mode the upgrade settings tab lists installed `data/app/v*`
  packages and can activate any non-current one with a graceful restart.
- `apply-local` rejects an unknown / malformed version and (outside package
  mode) reports that local apply is unavailable.
- The drain channel itself is unchanged — same code path as `/restart`.
- Tests: `VALID_VERSION_RE`, package-mode guard for `applyLocalVersion` /
  `listLocalAppVersions`.

## Out of scope

- Making the GitHub upgrade source (`bkhq/bkd`) configurable (option A).
- Smooth apply in `bun run dev` (no launcher — apply is package mode only).
- Auto-resume of turns interrupted by the restart (see UPGRADE-001 out of
  scope).

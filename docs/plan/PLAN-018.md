# PLAN-018 Migrate distribution and self-upgrade to lode

- **status**: completed
- **createdAt**: 2026-08-24 00:00
- **approvedAt**: 2026-08-24 00:00
- **relatedTask**: REL-002, REL-003, REL-004

## Context

BKD currently ships two distribution modes and owns its entire update path:

- **Binary mode** — `scripts/compile.ts --mode full` produces a ~105 MB Bun binary with
  frontend assets and migrations embedded (`apps/api/src/static-assets.ts` is rewritten at
  build time, served by `embedded-static.ts`).
- **Package mode** — `scripts/compile.ts --mode launcher` produces a ~90 MB launcher
  (`scripts/launcher.ts`, 602 lines) that reads `data/app/version.json`, downloads the app
  package from GitHub Releases on first run, and dynamically imports
  `data/app/v{version}/server.js`. `scripts/package.ts` builds that ~1 MB `.tar.gz`.

The in-process updater lives in `apps/api/src/upgrade/` (~890 lines across 10 files):
`github.ts` polls `repos/bkhq/bkd/releases/latest` hourly, `checker.ts` matches a
platform asset, `download.ts` streams it to `data/updates/` and verifies SHA-256 against
`checksums.txt`, `apply.ts` extracts to `data/app/v{version}/`, writes `version.json`,
runs a registered shutdown callback, writes a PID-lock handover token
(`pid-lock.ts:writeUpgradeToken`) and re-execs itself. `routes/settings/upgrade.ts`
exposes check/download/status/restart/downloads, and `AppSettingsDialog.tsx:1310-1578`
renders progress, checksum state and a restart button.

Mode branching leaks across the codebase: `root.ts:10-34` (`__BITK_PACKAGE_MODE__`,
`APP_DIR`, `/$bunfs` fallback), `server-main.ts:95-104` (three static-serving paths),
`db/migrations-source.ts:38`, `startup-banner.ts:9`, `routes/settings/about.ts:22`.

Windows was never actually supported: `.github/workflows/launcher.yml` builds only
linux/darwin targets, and the `win32` branch in `upgrade/utils.ts:60` is dead code.

[lode](https://github.com/dotns/lode) (dotns, MIT, v0.1.0 published 2026-07-01) is a
static Rust "verify · launch · update" supervisor covering the same ground plus
ed25519 publisher signatures, single-strike rollback, a readiness handshake, restart
supervision, version history and `hold` maintenance mode. It ships a zero-dependency
TypeScript SDK (`sdks/lode.ts`) and a documented Bun recipe
(`docs/recipes/bun.lode.toml`). It is Unix-only, which matches BKD's real support matrix.

Verified against the v0.1.0 release binary and source:

- Assets are selected by **exact filename** (`src/manifest.rs:691`); there is no
  templating, so a version-bearing asset name cannot be used.
- `state.json` carries `current` / `last_good` / `available` / `status` / `history` /
  `last_error` but **no download progress**.
- `lode.toml` is operator-owned; the app must never write it, so update *policy* can no
  longer be toggled from the BKD UI.
- Bare `lode --version` is consumed by lode itself (confirmed by running the binary).
- `[runtime].download` is TLS-protected but **not** hash- or signature-verified.

## Proposal

Single-track on lode. Package mode becomes the only packaged mode; binary mode and the
launcher are removed.

### 1. Release pipeline (REL-002)

- Publish `bkd-app.tar.gz` (fixed name — the lode selection key) and keep uploading
  `bkd-app-v{version}.tar.gz` with identical bytes so already-deployed launchers keep
  updating during the transition.
- Sign each asset with `lode-cli sign` when the `LODE_SIGNING_KEY` secret is set, passing
  the signature as the GitHub asset `label`; fall back to unsigned upload when unset.
- Delete `.github/workflows/launcher.yml`.

### 2. Runtime (REL-003)

- Vendor `sdks/lode.ts` as `apps/api/src/upgrade/lode-sdk.ts` (no npm package exists;
  dropping the file in is the documented distribution model). Keep it byte-faithful with
  an attribution header.
- Replace `upgrade/` internals with a thin service over the SDK:
  `getVersionInfo()`, `getUpgradeStatus()` (SDK `read()`), `requestUpgrade(version)`
  (`requestUpdate`), `requestRollback()`, `requestRestart()` (`reboot`). Delete
  `download.ts`, `checksum.ts`, `apply.ts`, `files.ts`, `github.ts`, `checker.ts`,
  `utils.ts`, `constants.ts` and their tests.
- `server-main.ts`: drop `registerShutdownForUpgrade` (lode drives restarts via SIGTERM,
  already handled at `server-main.ts:212`), drop the embedded-static branch, call
  `markReady()` once `Bun.serve()` is listening.
- `root.ts`: `ROOT_DIR` resolves `ROOT_DIR` env > `LODE_DIR` > dev fallback. The `/$bunfs`
  branch goes away with binary mode.
- Delete `scripts/launcher.ts`, `scripts/compile.ts`, `embedded-static.ts`,
  `static-assets.ts`; drop the `compile` / `compile:launcher` package scripts.
- Rework the settings UI onto lode state: current/available version, supervisor status,
  update / rollback / restart actions, last error. The auto-check toggle, download
  progress bar, checksum badge and downloaded-file list are removed — lode owns that
  policy and does not expose progress.

### 3. Migration + docs (REL-004)

- `scripts/migrate-to-lode.ts` — idempotent, `--dry-run` by default-safe: detects a
  launcher install (`data/app/version.json`), writes `lode.toml` with `dir` and
  `[env] ROOT_DIR` both pointed at the **existing install root** so `data/` (SQLite DB,
  uploads, worktrees) is never moved, then removes the stale `data/updates/` and
  `data/app/` trees and prints the `lode-cli seed` command that preserves the current
  version as a rollback target.
- `docs/deployment.md` — install, `lode.toml` reference for BKD, key trust setup, first
  run, upgrade/rollback operations, and the migration procedure.

## Risks

| Risk | Mitigation |
|---|---|
| Renaming the release asset silently strands existing launchers | Dual-upload the legacy `bkd-app-v{version}.tar.gz` name; migration notice in release notes |
| lode is v0.1.0 and becomes the trust root of the update path | Ship `policy = "check"` in the documented default config; pin the lode version in the guide; `require_signature = "enforce"` once keys are issued |
| Bun runtime download is unverified | Pin `[runtime].version`, keep `allowed_hosts` at its default gate, document baking bun into the image as the hardened alternative |
| CLI surface loss (`--port/--host/--data-dir/--log-level`) | These were pure env shims in `launcher.ts:455-457`; documented as env vars / `[env]` in the guide. `fix-db` survives as passthrough (`index.ts:14`) |
| `--help` / `--version` are swallowed by lode | Documented; `lode -- --version` forwards verbatim |
| Data loss during migration | Migration never moves `data/`; dry-run is the default and the script is idempotent |

## Scope

- Delete ≈2000 lines (`launcher.ts` 602, `compile.ts` 318, `upgrade/` internals ≈800,
  `embedded-static.ts` + `static-assets.ts` ≈90, upgrade tests ≈235).
- Add ≈600 lines (vendored SDK ≈420, service + routes ≈120, migration script ≈180).
- Touches: `apps/api/src/{root,server-main,startup-banner}.ts`,
  `apps/api/src/db/migrations-source.ts`, `apps/api/src/routes/settings/{about,upgrade}.ts`,
  `apps/frontend/src/{lib/kanban-api,hooks/use-kanban,components/AppSettingsDialog}.tsx`,
  `apps/frontend/src/i18n/{en,zh}.json`, `packages/shared/src/index.ts`,
  `.github/workflows/{release,launcher}.yml`, `package.json`, `CLAUDE.md`, `docs/`.

## Alternatives

- **Keep binary mode alongside lode** — rejected: two update paths to test, and the
  mode branching that motivates most of the deletion would survive.
- **Ship the compiled 105 MB binary as a lode `raw` asset instead of the app package** —
  fully signature-verified with no runtime download, but every update becomes 105 MB and
  `compile.ts` + embedded-static must stay. Rejected in favour of preserving the ~1 MB
  update property package mode was built for (PLAN-006 / REL-001).
- **Fork lode's logic into BKD** — rejected: that is the code being deleted.

## Annotations

- 2026-08-24 — User approved the full transition, explicitly accepting the Windows drop
  and requiring that existing installs keep their data via a migration script.
- 2026-08-24 — Implemented. Net -2540 lines. Two deviations from the plan, both forced by
  lode v0.1.0's actual behaviour and verified against the released binary:
  1. Release creation moved to the `gh` CLI (asset `label` is not settable through
     `softprops/action-gh-release`), and signing uses `${VERSION#v}` plus `sig:`-field
     extraction rather than upstream's documented one-liner.
  2. The settings "old versions" cleanup category was removed rather than repointed —
     `data/updates`/`data/app` are gone, and pruning lode's `versions/` would destroy the
     rollback target.
- 2026-08-24 — User deferred signature verification and asked for the lode config plus a
  usage guide to be published for seamless upgrades. Shipped configs now default to
  `require_signature = "off"` (sha256 integrity still enforced on every install), and each
  release publishes `bkd.lode.toml`, `DEPLOYMENT.md` and `migrate-to-lode.ts` as assets.
  Signing stays wired in CI and activates the moment `LODE_SIGNING_KEY` is set.
- 2026-08-24 — Reversed the dual-upload compatibility decision (Proposal §1, Risks row 1).
  Keeping `bkd-app-v{version}.tar.gz` would have let un-migrated installs auto-install a
  package that no longer self-updates, which is worse than not updating at all. The asset
  is now `bkd-server.tar.gz`, chosen so neither pre-lode selector can match it, and the
  legacy copy is gone. Migration is deliberate; un-migrated installs simply see no update.

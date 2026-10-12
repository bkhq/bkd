# 20261012-1547-lode-update-check Check for updates on demand and soften retried-error styling

- **status**: completed
- **priority**: P2
- **owner**: roy/lode-update-check
- **createdAt**: 2026-10-12 15:47

## Description

The vendored lode SDK is behind `bkhq/lode` `sdks/lode.ts`: upstream added
`requestCheck()` (`check_nonce` / `checked_nonce` / `check_error`). Without it
the only on-demand check is the Update button, which writes `target=latest`
and installs and restarts as soon as a newer version exists.

Separately, a Codex `error` notification with `willRetry: true`
("Reconnecting… n/5") renders in the chat as a red error box although the
turn continues.

Acceptance:

- `lode-sdk.ts` matches upstream verbatim.
- `POST /api/settings/upgrade/check` asks lode to check without installing;
  `UpgradeStatus` reports `checking` and `checkError`.
- The settings panel has a "check for updates" button; the Update button
  appears only when a newer version is advertised. A check that lode never
  answers stops spinning and says so.
- An `error-message` with `willRetry: true` renders as a warning, not an error.

## ActiveForm

Adding an on-demand update check

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Full tier; plan `20261012-1547-lode-update-check`.

- complete: upgrade-service and log-entry-error tests RED then GREEN; lint and typecheck pass; frontend 151/151; api 775 pass, 1 fail in api-execution.test.ts (the open concurrency flake, passes alone). Build not run; not verified against a live lode.

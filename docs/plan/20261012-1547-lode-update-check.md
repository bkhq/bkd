# 20261012-1547-lode-update-check Check for updates on demand and soften retried-error styling

- **status**: completed
- **createdAt**: 2026-10-12 15:47
- **approvedAt**: 2026-10-12 15:47
- **relatedTask**: 20261012-1547-lode-update-check

## Context

- `apps/api/src/upgrade/lode-sdk.ts` differs from upstream (lode 0.0.1,
  2026-10-11) by `requestCheck()` plus the `checkNonce` / `checkedNonce` /
  `checkError` state fields, and a Windows `SIGBREAK` hook in `onTerminate`
  (unused by BKD).
- lode contract (`docs/integration.md` §2): bump `check_nonce`; the check is
  finished once `checked_nonce` reaches it. `check_error` holds the failure,
  otherwise `available` is the newer version. The check only reports, except
  under `policy = "auto"` where lode applies the version itself.
- `AppSettingsDialog.tsx` keeps the Update button always enabled because
  requesting `latest` was the only way to check on demand.
- `LogEntry.tsx` renders every `error-message` in destructive colours; the
  Codex normalizer already records `willRetry` on `error` notifications.

## Proposal

1. Re-copy `sdks/lode.ts` over `lode-sdk.ts`.
2. `service.ts`: `requestCheck()`; `getUpgradeStatus()` adds
   `checking = checkNonce > checkedNonce` and `checkError`.
3. `POST /api/settings/upgrade/check`; extend `UpgradeStatusSchema` and the
   shared `UpgradeStatus` type.
4. Frontend: `checkForUpdate` client call and `useCheckUpgrade` hook, fast
   polling while `checking`, a check button, Update shown only with
   `hasUpdate`, `checkError` line, 30 s give-up for a lode that never answers.
5. `LogEntry.tsx`: amber styling when `metadata.willRetry === true`.
6. Tests first: `upgrade-service.test.ts`, `log-entry-error.test.tsx`.
7. `docs/deployment.md`, changelog.

## Risks

- A lode older than 0.0.1 ignores `check_nonce`; the panel gives up after 30 s
  and points at upgrading lode.
- Under `policy = "auto"` a check installs the version it finds.

## Scope

`apps/api/src/upgrade/`, `apps/api/src/routes/settings/upgrade.ts`,
`apps/api/src/openapi/extra-schemas.ts`, `packages/shared`,
`apps/frontend` (API client, hook, settings dialog, `LogEntry`, i18n), docs.
Not in scope: replacing status polling with an SSE push.

## Alternatives

- Keep `target=latest` as the check: installs without a preview.
- Push lode state over SSE via `Lode.watch()`: larger change for a panel that
  only polls while open.

## Annotations

Approved in the request ("fix it"), together with the warning styling.

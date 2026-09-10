# AUDIT-001 Fix API and repository audit findings

- **status**: completed
- **priority**: P1
- **owner**: maintainer/audit-20260910
- **createdAt**: 2026-09-10 00:00

## Description

Implement the approved repository audit remediation in PLAN-021. Preserve the
existing CRON-004 working-tree changes. No commits or pushes are requested.

## Acceptance Criteria

- SQLite multi-statement writes roll back on failure and concurrent issue creation succeeds.
- Cron pagination traverses every row once in a deterministic order.
- JSON and multipart requests share validation; HTTP errors use the API envelope.
- REST contracts cover runtime endpoints and documentation assets load under CSP.
- CORS permits the implemented methods; CI checks main pushes and exposes consistent commands.
- Remove obsolete schemas, address bounded list reads and cron query fan-out, and update stale project guidance.
- Add regression tests before fixes and pass relevant suites, lint, typecheck, and build.

## Notes

The user approved implementation after reviewing the September 8 audit.

## Implementation Record

- Made all nine SQLite transaction callbacks synchronous, with explicit query execution. Added an ESLint restriction against async transaction callbacks.
- Fixed cron pagination with a timestamp/id cursor and deterministic ordering; batched latest-run lookups.
- Unified request schemas, malformed-body errors, multipart limits, and supported media types. Added PUT to CORS and request IDs to structured HTTP logs.
- Completed REST operation metadata and path parameters, and bundled Swagger assets for same-origin documentation under CSP.
- Defaulted issue lists to 100 records (maximum 200); the frontend follows cursors to retain complete boards.
- Validated server/runtime configuration, aligned quality commands, enabled main-push CI, pinned Bun, and enforced frozen dependency installs.
- Updated project and API guidance while preserving unrelated working-tree changes.

## Verification

- Reproduced transaction/concurrency, cursor, validation, CORS, contract, pagination, and configuration failures before implementation; regression checks pass after fixes.
- Full worktree suites: API 666 passed, 1 skipped; frontend 96 passed across 13 files.
- Root lint and typecheck passed. Lint retains two existing frontend warnings in AppSettingsDialog and ProjectSettingsDialog.
- Frontend production build and Bun API bundle build passed. Existing frontend chunk-size warnings remain.
- Browser smoke check: Swagger rendered 120 operations with no browser errors; documentation assets loaded locally.
- `git diff --check` passed.
- A synthetic async transaction callback was rejected by the new ESLint rule; the final backend suite, lint, and typecheck passed after the last schema refinement.

## Compatibility and Remaining Scope

- External issue-list clients must follow the opaque `nextCursor`; existing URLs and response envelopes are preserved.
- The legacy unpaginated cron-list response remains available for compatibility; paginated cron clients must treat the new composite cursor as opaque.
- Runtime validation covers server binding, logging, allowed origins, execution capacity, and the worktree directory. Engine-specific credentials and other existing settings retain their current handling.
- No database migrations, deployment, commits, or pushes were performed.

- complete: Completed remediation and verification; compatibility notes and remaining warnings recorded.

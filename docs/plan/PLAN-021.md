# PLAN-021 API and repository audit remediation

- **status**: completed
- **createdAt**: 2026-09-10 01:58
- **approvedAt**: 2026-09-10
- **relatedTask**: AUDIT-001

## Context

The audit reproduced premature SQLite transaction commits, concurrent issue-number
collisions, incorrect cron keyset pagination, inconsistent request validation and
error responses, incomplete REST documentation, blocked documentation assets, and
missing PUT in CORS. Existing CRON-004 edits belong to a separate completed task.

## Implementation

1. Add deterministic transaction, pagination, validation, CORS, and contract regressions.
2. Replace async SQLite transaction callbacks with synchronous queries. Verify rollback and concurrent writes.
3. Align cron cursors with ordering and batch latest-log lookups. Verify multi-page traversal.
4. Share request schemas, normalize request errors and media types, complete REST metadata, and serve documentation assets compatibly with CSP. Verify API contracts and documentation.
5. Bound list requests while preserving complete frontend boards, validate runtime settings, and add structured request correlation.
6. Align CI/main triggers, noninteractive commands, and project guidance. Run all quality gates and review the final diff.

## Compatibility

Keep the existing success/error envelope and endpoint URLs. Preserve multipart
attachments and existing project-scoped ownership checks. Retain explicitly
documented streaming and WebSocket exceptions. Avoid database schema migrations
and unrelated framework or dependency upgrades.

Retain the existing Swagger renderer and add its local distribution assets to
fix CSP/offline loading without changing the documentation UI. This is an
intentional exception to the stack pack's default Scalar renderer.

## Verification

RED/GREEN regressions, full suite totals, lint/typecheck/build results, browser
documentation verification, and compatibility limitations are recorded in
`../task/AUDIT-001.md`. All acceptance checks passed; existing lint and bundle-size
warnings remain documented there.

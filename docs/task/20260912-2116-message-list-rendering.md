# 20260912-2116-message-list-rendering Investigate message list stutter and overlapping rows

- **status**: completed
- **priority**: P1
- **owner**: reviewer/session-20260912-2116
- **createdAt**: 2026-09-12 21:16

## Description

Audit message-list rendering, dynamic row measurement, streaming updates, and history pagination. Provide reproducible findings and a scoped remediation proposal before implementation.

Acceptance criteria:

- Trace the rendering and scroll call chains and existing test coverage.
- Verify concrete causes of row overlap and excessive rendering with focused experiments.
- Record evidence, verification limits, and a proposed regression-test scope.

## ActiveForm

Completed message-list rendering and scrolling remediation.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier investigation. Application changes require proposal approval.
- File-only task tracking; no task-state connector is available.

- 2026-09-12 21:24 UTC: Browser reproduction confirmed persistent overlap after history prepend, automatic bottom-follow loss, and redundant HTML sanitization. Existing frontend tests: 99 passed. Proposal: [layout and streaming remediation](../plan/20260912-2124-message-list-rendering.md). Application source is unchanged; awaiting proposal approval.

- 2026-09-13 00:20 UTC: User approved the remediation proposal. Adding failing regressions before application changes.

- 2026-09-13 00:42 UTC: Implemented the approved frontend fixes. Seventeen new regression cases and all 116 frontend tests pass; browser overlap, anchor, resize, and streaming scenarios pass. Lint/typecheck/build pass in a pinned container. The full gate retains the documented API timeout, which passes in isolation. See the plan for exact commands and measurements.

- complete: Completed the approved fixes, 17 new regressions, all 116 frontend tests, browser checks, and lint/typecheck/build. The documented full API-suite timeout passes in isolation.

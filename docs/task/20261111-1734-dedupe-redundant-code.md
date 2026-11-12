# 20261111-1734-dedupe-redundant-code Remove duplicated implementations and dead code found by the redundancy audit

- **status**: completed
- **priority**: P2
- **owner**: claude/session-dedupe
- **createdAt**: 2026-11-11 17:34

## Description

A repository audit (snapshot `3bbabc6`) found several features implemented more than once, with the copies already
drifting apart, plus dead code and repeated frontend boilerplate. Collapse each onto one implementation and delete
what nothing reaches. Public REST routes keep their URLs and response shapes.

Acceptance: `bun run check` passes; every duplicated block listed in the plan has a single owner; no behavior change
other than the cron `issue-execute` action gaining what the execute route already does.

## ActiveForm

Collapsing duplicated implementations and removing dead code

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261111-1734-dedupe-redundant-code](../plan/20261111-1734-dedupe-redundant-code.md)

- complete: Implemented; lint, typecheck, tests, build and a browser pass are green. Deviations are listed in the plan's Outcome section.

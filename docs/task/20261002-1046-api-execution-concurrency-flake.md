# 20261002-1046-api-execution-concurrency-flake Fix order-dependent concurrency failure in api-execution tests

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-02 10:46

## Description

In a full `bun run test:api` run, `api-execution.test.ts` > "Auto-execute on issue
creation > async execution transitions to running then completed" times out: the
auto-execute fails with `Concurrency limit reached (5/5)` because processes from
earlier test files still occupy the shared `issueEngine` process manager. The file
passes on its own. Reproduces on `1dbcee9` without any change.

Acceptance: the full API suite passes regardless of file order.

## ActiveForm

Fixing the order-dependent api-execution test failure

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Found while verifying `20261002-1007-engine-process-leak`.

## Resolution

Same root cause as `20261013-0538-spawn-leak-tests-order-dependent`: real engine CLIs spawned by earlier test files held the shared process manager's slots. Fixed there; the full API suite passes (917 / 0, twice).

- complete: Resolved by 20261013-0538

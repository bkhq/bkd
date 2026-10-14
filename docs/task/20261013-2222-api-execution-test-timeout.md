# 20261013-2222-api-execution-test-timeout api-execution test times out in the full suite

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-10-13 22:22

## Description

`Auto-execute on issue creation > async execution transitions to running then
completed` (`apps/api/test/api-execution.test.ts:50`) times out after 5000 ms
when run through `bun run test:api`, so `bun run check` fails. The same file
passes when run on its own (17 pass), which points at cross-file interference
rather than the test itself.

Observed on 2026-10-13 with the uncommitted
`20261013-2159-decision-telegram-interactive` work in the tree; not verified
against a clean `HEAD`.

Acceptance criteria:

- The cause of the interference is identified.
- `bun run test:api` passes.

## ActiveForm

Diagnosing the api-execution test timeout

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

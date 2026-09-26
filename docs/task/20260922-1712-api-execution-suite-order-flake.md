# 20260922-1712-api-execution-suite-order-flake Auto-execute test times out in the full API suite

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-22 17:12

## Description

`test/api-execution.test.ts` > "async execution transitions to running then
completed" times out after 5s when the whole API suite runs
(`bun test --preload ./test/preload.ts`), but passes when the file runs alone.
Reproduced on an untouched `HEAD` checkout on 2026-09-22, so it is not caused
by any pending change. The log shows `[issue] Concurrency limit reached (5/5)`
raised from `process-manager.ts` during `auto_execute_failed`, which points at
process registrations leaking from earlier test files into the shared
`ProcessManager` singleton.

Acceptance criteria:

- The full API suite passes deterministically.
- Root cause (leaked registrations or missing per-file reset) is fixed rather
  than the timeout raised.

## ActiveForm

Fixing the order-dependent auto-execute test timeout

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Found while verifying 20260922-1703-mobile-desktop-ui-parity.

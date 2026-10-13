# 20261013-2212-decision-event-retention Delete decided decision events after one day

- **status**: completed
- **priority**: P2
- **owner**: main/decision-retention-20261013
- **createdAt**: 2026-10-13 22:12

## Description

Decision events stay in the table forever, so the decision inbox keeps
accumulating answered events. Remove an event one day after it was decided.

Acceptance criteria:

- An event in any status other than `open` is removed once the retention period of one
  day has passed.
- Open events are never removed, however old.
- Removal runs unattended on a schedule.

## ActiveForm

Adding retention for decided decision events

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

- complete: Scope widened on user instruction to every non-open status. Focused test passes (4); lint and typecheck clean; full API suite has one failure in api-execution.test.ts that also fails with this change backed out (tracked as 20261013-2222-api-execution-test-timeout).

# 20261017-0516-message-cleanup-terminal-only Keep answered messages out of the cleanup

- **status**: completed
- **priority**: P1
- **owner**: claude/message-cleanup-terminal
- **createdAt**: 2026-10-17 05:16

## Description

`message-cleanup` soft-deletes every message awaiting a reply that is not `open` and has been
unchanged for a day. That includes `decided` and `replied`: if the sender missed its wake and did
not ack within a day, the user's answer disappears from the API (v1 `/api/decisions` included).

Acceptance criteria:

- Only terminal states (`applied`, `withdrawn`, `closed`) are removed after one day.
- `open`, `decided` and `replied` are never removed, however old.
- Read notifications keep the 7-day rule.

Reverses the widening recorded in 20261013-2212-decision-event-retention.

## ActiveForm

Restricting message cleanup to terminal states

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

- complete: message-cleanup tests 7/7 (RED then GREEN); API suite 924/925, the one failure is the known api-execution timeout (20261013-2222).

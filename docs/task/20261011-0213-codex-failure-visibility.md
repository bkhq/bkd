# 20261011-0213-codex-failure-visibility Surface Codex turn failures and stop stall probes from ending Codex turns

- **status**: completed
- **priority**: P1
- **owner**: claude/session-audit-fixes
- **createdAt**: 2026-10-11 02:13

## Description

Reported as "Codex tasks disconnect and in-progress tasks land in review".
Production data (`/srv/bkd`, 45 days) shows:

1. Every Codex turn failure is invisible. `isVisible()` drops all
   `error-message` entries (commit `cc74551`, meant for stderr noise), so the
   Codex `error` notification, the failed `turn/completed`, and the thread
   `systemError` never reach the chat or the SSE stream. Issue `1mtwtmv8`:
   8 turns in a row ended with `cyberPolicy` ("flagged for possible
   cybersecurity risk"); the user saw the work stop and the card move to
   review with no reason. `responseStreamDisconnected` retries (8 entries,
   2 issues) are hidden the same way.
2. The stall probe interrupts live Codex turns. After 5 min without stdout the
   GC calls `protocolHandler.interrupt()` (`turn/interrupt`); Codex answers
   with `turn/completed status=interrupted`, which the failure detector
   treats as a logical failure (`resultSubtype !== 'success'`) because
   `lastInterruptAt` is only set by a user cancel. Issue `291mlkld`
   (853k-token turn) was ended this way and marked failed.
3. `thread/resume` triggers Codex's deprecation notice 13 times: full-history
   hydration is deprecated; pass `excludeTurns: true`.

Acceptance:

- Engine-reported errors (Codex `error`, failed/interrupted turn, thread
  `systemError`; Claude `error`; BKD `emitErrorLog`) are visible in the chat
  and over SSE; raw stderr lines stay hidden.
- A stall probe never ends a Codex turn; a Codex process is only killed when it
  is dead or exceeds a long cap.
- `thread/resume` sends `excludeTurns: true` and the deprecation notice stops.
- Tests cover the visibility split, the Codex stall path and the resume params.

## ActiveForm

Surfacing Codex turn failures

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261011-0213-codex-failure-visibility.md`.

- complete: New tests pass; lint (0 errors), typecheck pass; API suite 772/774 with the known api-execution order flake; frontend 147/147.

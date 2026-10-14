# 20261013-2159-decision-telegram-interactive Answer decision events from Telegram

- **status**: completed
- **priority**: P2
- **owner**: main/decision-telegram-20261013
- **createdAt**: 2026-10-13 21:59

## Description

Notifications are one-way today and decision events are not notified at all, so
a question raised by a coordinating agent waits until the user opens the
decision inbox. Let the user see a decision event in an external chat tool and
answer it there, starting with Telegram.

Acceptance criteria:

- Decision-event transitions are available as notification events on the
  existing webhook and Telegram channels.
- A Telegram channel marked interactive posts each open decision event with one
  button per option, accepts a button press or a text reply as the decision,
  and can close the event.
- A decision made anywhere (inbox, REST, Telegram) updates the Telegram message
  and removes its buttons.
- Only the configured chat can decide; `decidedBy` records the Telegram user.
- The decision goes through the same state transition and follow-up delivery as
  the REST route.

## ActiveForm

Designing two-way decision events over Telegram

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261013-2159-decision-telegram-interactive.md`.
- 2026-10-13: interactive Telegram channel implemented (plan step 2). Remaining: `decision.*` notification events (plan step 1), the first acceptance criterion.

- complete: Telegram answering and decision.* notification events done; tests, lint and typecheck pass.

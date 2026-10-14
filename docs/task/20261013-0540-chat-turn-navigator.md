# 20261013-0540-chat-turn-navigator Add a turn navigator rail with hover previews to the chat area

- **status**: completed
- **priority**: P2
- **owner**: cd/chat-turn-navigator
- **createdAt**: 2026-10-13 05:40

## Description

Long issue chats have no way to jump between turns except scrolling. Add a
vertical rail at the right-middle of the chat area: one tick per user message
(turn), the tick of the turn in view highlighted. Hovering a tick previews the
user message (up to 3 lines) and the start of the agent reply (up to 2 lines);
clicking scrolls to that turn.

Acceptance criteria:

- Works for both the plain and the virtualized (>= 80 messages) message list.
- Jumping pauses auto-follow, so a running issue does not snap back to the
  bottom.
- Covers loaded turns only; hidden with fewer than 2 turns and on narrow
  viewports; the rail scrolls when ticks do not fit.
- i18n keys in `en.json` and `zh.json`; vitest coverage for turn
  extraction, previews and click-to-jump; frontend suite, lint, typecheck pass.

## ActiveForm

Adding a chat turn navigator.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261013-0540-chat-turn-navigator.md`.

- complete: turn-navigator.test.tsx 7/7 and 2 new SessionMessages cases (plain + virtualized); frontend suite 194/194, typecheck, eslint, build pass; checked in the dev app (hover preview, click-to-jump, active tick).

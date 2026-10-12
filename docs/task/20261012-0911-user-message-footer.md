# 20261012-0911-user-message-footer Give sent messages a footer with time and a copy action

- **status**: completed
- **priority**: P2
- **owner**: cd
- **createdAt**: 2026-10-12 09:11

## Description

Assistant messages show a footer with timestamp, duration and copy actions
(UI-009). Sent (user) messages are a bordered card with no timestamp and no
way to copy the text; the queued / completed badges sit inside the card.

Align the two:

- Typography matches assistant messages (14px, 1.75 line height); the card
  gets rounded corners and a lighter border.
- A footer row below the card shows the timestamp, the queued / completed
  badge when present, and a hover-revealed copy button that copies the
  message text without the attached-files block.
- The icon copy button is extracted from `AssistantMessage` into a small
  shared component so both footers use the same control.

Acceptance criteria:

- User messages render timestamp and a "Copy message" button in the footer;
  the button copies the display text and shows a transient copied state.
- Queued / completed badges still appear, now in the footer.
- i18n keys exist in `en.json` and `zh.json`.
- Focused vitest cases pass, then the frontend suite, lint, typecheck, build.

## ActiveForm

Adding a footer to sent messages.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Requested by the user on 2026-10-12 with a screenshot; implemented on
  `release` and noted in #145.
- Assumption: "adjust the style" was read as aligning with assistant messages
  (14px / 1.75, rounded card, lighter border) while keeping the coloured left
  bar that encodes queued / completed.

- Follow-up (user: styles not unified): all chat containers now share one
  shape, `rounded-lg border border-border/30`: user card (left 3px bar is
  the only coloured edge), error box, command-output and thinking
  `<details>`, the tool-group box and the todo panel.

- Follow-up: the queued-message cards in `ChatBody` were a copy of the old
  user-card markup, so they missed every change above. `UserMessageEntry` is
  now exported with optional `projectId` / `issueId` / `onEdit` props and
  ChatBody renders queued messages through it; the inline copy, its preview
  modal state and the related imports are gone.

- complete: focused tests, frontend suite, lint, typecheck and build passed.

## Verification

- New `user-message-entry.test.tsx`: 2 passed (timestamp shown, copy writes the
  text without the attached-files block and shows the copied state; queued
  badge sits in the footer row with the timestamp).
- Frontend suite: 26 files, 166 passed. `bun run lint` 0 errors (2
  pre-existing warnings), `bun run typecheck`, `bun run build` pass.

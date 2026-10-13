# 20261013-0155-agent-message-card-style Style agent messages as a card matching user messages

- **status**: completed
- **priority**: P2
- **owner**: cd/agent-message-card
- **createdAt**: 2026-10-13 01:55

## Description

Agent messages got a borderless `bg-muted/40` surface in
`20261012-2028-chat-heading-size-and-agent-bg`, which does not match the user
message card (`border border-border border-l-[3px]`, `px-3 py-2.5`, outer
`py-2`) and makes the two look like unrelated components.

Give `AssistantMessage` the same card structure as `UserMessageEntry` and
mark it with its own colour: a primary-tinted left bar and background, where
user messages use the neutral foreground bar.

Acceptance criteria:

- Agent and user messages share border, radius, left-bar width, padding and
  outer spacing; only the bar and background colours differ.
- Focused vitest case passes, then the frontend suite, lint, typecheck.

## ActiveForm

Restyling agent messages as a card.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

- complete: Focused test RED then GREEN; frontend suite (185 passed), lint and typecheck passed.

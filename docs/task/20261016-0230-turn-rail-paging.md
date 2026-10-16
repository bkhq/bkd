# 20261016-0230-turn-rail-paging Page the chat turn rail and keep the current turn visible

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-16 02:30

## Description

The turn navigator draws one tick per turn in a rail that covers the middle 60% of the
chat height (8px per tick, about 40 ticks at 800px). Longer conversations overflowed
into a scroll area with a hidden scrollbar that started at the top, so the highlighted
current turn (usually the newest, at the bottom) sat in the hidden part: measured on the
live instance, 115 turns needed 920px in a 323px rail, 584 turns 4672px.

Acceptance criteria (user's design: keep the ~40 visible ticks, add up/down buttons):

- When ticks overflow, up and down buttons above and below the rail page it by 80% of
  its height; each is disabled at its end. No buttons while everything fits.
- When the current turn changes and its tick is outside the rail, the rail scrolls to
  center it (so it is visible on open); paging does not change the current turn.

## ActiveForm

Adding paging to the chat turn rail

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

- complete: Paging buttons + follow current turn; browser-verified on an 83-turn issue

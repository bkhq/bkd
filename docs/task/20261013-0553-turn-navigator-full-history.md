# 20261013-0553-turn-navigator-full-history Show every turn in the chat turn navigator, including unloaded history

- **status**: completed
- **priority**: P2
- **owner**: cd/turn-navigator-history
- **createdAt**: 2026-10-13 05:53

## Description

The turn navigator (`20261013-0540-chat-turn-navigator`) lists loaded turns
only. Logs are paginated (`DEFAULT_LOG_PAGE_SIZE = 10` conversation messages
per "load more"), so a long chat shows a handful of ticks while older turns
sit behind the "load more" button.

Acceptance criteria:

- The rail lists every turn of the issue, loaded or not, with previews.
- Clicking an unloaded turn loads history up to it and scrolls there.
- Backend and frontend tests cover the turn list and the jump; `bun run
  check` gates pass (lint per workspace, see
  `20261013-0538-bkd-log-rotation`).

## ActiveForm

Listing the full turn history in the navigator.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261013-0553-turn-navigator-full-history.md`.

- complete: api-issue-turns.test.ts 3/3; loadOlderUntil, mergeTurns, far-jump confirm and unloaded-jump cases added (all RED first); frontend 200/200, api 768 pass with only the 6 known engine-spawn-leak failures; typecheck, eslint pass; checked in the dev app on a paginated issue.

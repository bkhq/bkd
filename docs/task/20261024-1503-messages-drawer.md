# 20261024-1503-messages-drawer Show the messages inbox in a side drawer instead of a page

- **status**: completed
- **priority**: P2
- **owner**: claude/messages-drawer
- **createdAt**: 2026-10-24 15:03

## Description

Move the messages inbox (decisions + notifications) from the `/messages` page into a
global side drawer built on `SidePanel`, styled and behaving like the terminal drawer
(resizable, minimize, fullscreen, close). Menu entries open the drawer instead of
navigating. `/messages` and `/decisions` stay valid for external links (webhook inbox URL)
and open the drawer.

## ActiveForm

Moving the messages inbox into a side drawer

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261024-1503-messages-drawer

- complete: bun run check passed (frontend 394 tests, api 986). Browser check skipped: agent-browser not installed.

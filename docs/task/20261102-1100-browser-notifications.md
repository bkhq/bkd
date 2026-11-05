# 20261102-1100-browser-notifications Show browser notifications for review and new messages

- **status**: completed
- **priority**: P2
- **owner**: claude/browser-notifications
- **createdAt**: 2026-11-02 11:00

## Description

Add a `browser` notification channel next to Webhook and Telegram. The user creates it manually from
Settings → Notifications ("Add notification"), picks its events like any other channel, and grants the
browser permission from a button in that form (never automatically). A delivery is pushed over SSE as
`browser-notification` and shown through the Notification API by every open BKD tab with permission. Clicking
one focuses the tab and opens the issue or the messages drawer. Also fix the channel card's event list, which
did not wrap and squeezed CJK labels into vertical columns.

Acceptance:
- No browser row or permission prompt until the user creates a browser channel and clicks "Allow".
- A browser channel needs no URL or secret; webhook and Telegram validation is unchanged.
- Only the events the channel subscribes to are shown; the test button shows one.
- The channel card's event labels wrap as whole words.

## ActiveForm

Adding browser notifications

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261102-1100-browser-notifications](../plan/20261102-1100-browser-notifications.md)

- complete: bun run check passed; notifier unit tests cover review, message, focus, permission and dedup paths.

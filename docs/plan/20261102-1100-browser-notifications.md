# 20261102-1100-browser-notifications Browser notifications for review and new messages

- **status**: completed
- **createdAt**: 2026-11-02 11:00
- **approvedAt**: 2026-11-02 11:10
- **relatedTask**: 20261102-1100-browser-notifications

## Context

- No browser notification code exists; `public/manifest.json` exists, no service worker.
- The existing notification channels (`apps/api/src/webhooks/dispatcher.ts`) announce, among others,
  `issue.status.review` (any `issue-updated` with `statusId: review`, automatic or manual),
  `decision.opened` and `message.sent`.
- The frontend already receives the matching SSE events through `lib/event-bus.ts`:
  `onIssueUpdated` (`{ issueId, changes }`) and `onMessageUpdated` (`{ id, kind, expects, status }`).
  Neither carries a title or project id.
- `GET /api/issues/review` (`kanbanApi.getReviewIssues`) lists every review issue with `projectId`, `title`,
  `projectName`; `GET /api/messages/items/:id` returns a message with `title` (no client function yet).
- The Notifications settings tab is `components/settings/WebhookSection.tsx` (label `settings.tabWebhooks`).
- bks reference: `/srv/ai/bks/apps/web/src/features/inbox/browser-notifier.ts` — requests permission on app
  open, preferences show permission + request button, notifies only when `!document.hasFocus()`, `tag` per
  item, click focuses and navigates. No secure-context hint.

## Proposal

Revised after review: browser notifications are a channel type, not a fixed frontend feature.

1. `@bkd/shared`: `NotificationChannel` gains `'browser'`; new `BrowserNotificationEvent`
   (`webhookId`, `event`, `title`, `projectName`, `projectId`, `issueId`, `messageId`) in `SSEEventMap` and
   `AppEventMap` as `browser-notification`. The `channel` column is text, so no migration.
2. API: the webhook schemas accept `browser`; create stores an empty URL and no secret for it (create `url` no
   longer has `min(1)`; webhook and Telegram checks still reject an empty one); update ignores URL/secret for it.
   `deliver()` emits `browser-notification` built by `buildBrowserNotification()` from the event payload
   (issue / session events → issue title and ids; `decision.*` → question and message id; `message.*` → title
   and message id) and records a successful delivery. `/api/events` forwards it.
3. Frontend: `eventBus.onBrowserNotification`; `useBrowserNotifications()` shows each one while permission is
   granted (`tag` = event + item id); `toBrowserNotification()` formats title/body with the event label
   (`EVENT_LABEL_KEYS` moved to `lib/webhook-events.ts`). The channel form gets a "Browser" option with the
   permission state and an "Allow notifications" button instead of URL/secret; the card shows "Browser".
   The card's event list wraps (`flex-wrap`, `whitespace-nowrap`).
4. Tests: `apps/api/test/webhook-browser.test.ts` (create without target, empty webhook URL rejected,
   subscribed / unsubscribed issue events, message event); `__tests__/hooks/use-browser-notifications.test.ts`.

## Risks

- Works only in a secure context (HTTPS or localhost) and while a BKD tab is open; accepted.
- Several open tabs each show the notification; the shared `tag` makes the browser replace rather than stack.
- A browser delivery is recorded as successful once pushed, whether or not a tab showed it; accepted.
- A manual drag to review also notifies, same as the webhook event, including in the tab that made the move.

## Scope

Shared types, the webhook routes, dispatcher and SSE route in `apps/api`, and the notifications settings and
event bus in `apps/frontend`. No schema migration.

## Alternatives

- Add a `browser` channel type to the webhook system (server-side event selection, delivered via SSE): more
  configurable, but needs backend changes and its delivery log would report success with no browser listening.
- Web Push: works with the tab closed, but needs a service worker, VAPID keys, a subscription table and
  outbound access to vendor push services. Rejected.

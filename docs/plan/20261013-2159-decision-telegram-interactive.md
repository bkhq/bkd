# 20261013-2159-decision-telegram-interactive Answer decision events from Telegram

- **status**: completed
- **createdAt**: 2026-10-13 21:59
- **approvedAt**: 2026-10-13 22:09
- **relatedTask**: 20261013-2159-decision-telegram-interactive

## Context

Current state:

- `apps/api/src/webhooks/dispatcher.ts` is outbound only. It listens to
  `issue-updated`, `done` and `state` on `appEvents` and delivers to rows of the
  `webhooks` table. A row is either `channel = 'webhook'` (POST JSON to `url`)
  or `channel = 'telegram'` (`url` holds the chat id, `secret` the bot token,
  delivery is one `sendMessage`).
- `WebhookEventType` (`packages/shared/src/index.ts`) has issue and session
  events only. Decision events emit `decision-event-updated` on the bus and
  over SSE, but nothing notifies an external channel, so the user learns about
  a question only by opening `/decisions`.
- Deciding lives inside the route handler `routes/decisions.ts`
  (`decideDecisionEvent`): validate the option, `updateFrom(id, ['open'], …)`
  as an atomic compare-and-set, then `notifyDecision()` sends the wake
  follow-up. It is not callable from anywhere else. Closing is the same shape.
- The API has no authentication; `decidedBy` is a declared string defaulting
  to `user`.
- BKD usually runs on a private host (`bkd.localhost`, lode-supervised), so it
  cannot be assumed to have a public HTTPS endpoint.
- `getServerUrl()` gives the configured external URL used for links in
  notifications. Latest migration is `0025`+ (decision events).

Telegram Bot API facts that shape the design:

- Inbound updates arrive either by `setWebhook` (needs public HTTPS) or by
  `getUpdates` long polling (outbound only). One consumer per bot token: a
  second poller, or a bot with a webhook set, gets HTTP 409.
- Unconfirmed updates are kept for 24 h and re-delivered until a `getUpdates`
  call passes a higher `offset`, so the offset does not need to be persisted.
- `callback_data` on an inline button is limited to 64 bytes. Option ids can be
  50 chars of any script, so they do not fit reliably.
- Message text is limited to 4096 chars; `context` can be 20 000.

## Proposal

Two steps. Step 1 is useful alone and is the base for step 2.

### Step 1 — decision events as notification events (one-way)

- Add `decision.opened`, `decision.decided`, `decision.applied`,
  `decision.withdrawn`, `decision.closed` to `WebhookEventType` and a
  `decision` group in `WEBHOOK_EVENT_GROUPS`.
- `initWebhookDispatcher()` listens to `decision-event-updated`, loads the
  event through `serializeEvent()`, and dispatches with dedup key
  `decision.<status>:<eventId>`. A `decision-event-updated` for an event that
  is still `open` and was already announced (an edit) is not re-dispatched.
- Payload: the serialized `DecisionEvent` plus `decisionsUrl`
  (`<serverUrl>/decisions`) and `apiUrl`
  (`<serverUrl>/api/decisions/events/<id>`).
- `formatTelegramMessage()` gets a decision branch (question, options with
  impact, recommendation, blocks/continues, outcome).

This already makes the generic `webhook` channel two-way for anyone who runs
their own bridge: the receiver gets `apiUrl` and answers with the existing
`POST …/decision`. No new inbound surface is added to BKD.

### Step 2 — interactive Telegram channel

**Transport: long polling.** BKD pulls updates with `getUpdates`; nothing has
to reach BKD from the internet, and no inbound endpoint is added to an
unauthenticated API.

**Shared decide path.** Move the body of the decide and close handlers into
`decisions/service.ts`:

```ts
type DecideResult =
  | { ok: true, row: DecisionEventRow, notified: boolean }
  | { ok: false, reason: 'not-found' | 'bad-option' | 'conflict', status?: string }

export async function decideEvent(id: string, input: {
  optionId: string | null
  instruction: string
  decidedBy: string
}): Promise<DecideResult>

export async function closeEvent(id: string, reason: string | null): Promise<…>
```

The routes become thin callers; behaviour and responses do not change.

**Data model** (one migration):

- `webhooks.interactive` — boolean, default `false`. Only meaningful for
  `channel = 'telegram'`. Opt-in, because polling takes over the bot's update
  stream.
- `decision_channel_messages` — `id`, `webhookId`, `eventId`, `chatId`,
  `messageId`, `commonFields`; unique on (`webhookId`, `eventId`), index on
  (`chatId`, `messageId`). Maps an event to the message that carries it, for
  editing on settle and for resolving a text reply back to its event.

**Module layout** (`apps/api/src/decisions/telegram/`):

- `client.ts` — `sendMessage`, `editMessageText`, `answerCallbackQuery`,
  `getUpdates` over `fetch`; never logs the token-bearing URL.
- `render.ts` — pure functions: event → message text + inline keyboard; parse
  and build `callback_data`.
- `poller.ts` — one long-poll loop per distinct bot token among active
  interactive rows (`timeout=50`, `allowed_updates=["callback_query","message"]`),
  in-memory offset, exponential backoff, slow retry on 409, `AbortController`
  for shutdown.
- `index.ts` — `startDecisionTelegram()` / `stop()` / `reload()`; subscribes
  to `decision-event-updated`; `reload()` is called by the webhook settings
  routes after create/update/delete. Wired in `server-main.ts` next to
  `initWebhookDispatcher()` and into the graceful shutdown.

No channel registry or plugin interface yet: the module's surface is
`publish(event)`, `settle(event)`, `start/stop/reload`, which is the seam a
second tool (Slack, Feishu, Matrix) would implement when it is actually added.

**Outbound flow** (on `decision-event-updated`):

| event state | message row exists | action |
|---|---|---|
| `open` | no | `sendMessage` with keyboard, insert row |
| `open` | yes | `editMessageText` (event was edited by the raiser) |
| `decided` / `applied` / `withdrawn` / `closed` | yes | `editMessageText` with the result, keyboard removed |

Interactive rows are skipped by the step-1 dispatcher for `decision.*`, so a
chat never gets both a plain and an interactive message for the same event.

Message layout: question, project and `ref` issue, truncated `context`
(link to `/decisions` for the full text), options as `A — label · impact` with
the recommended one marked, `blocks` / `continues`. Keyboard: one button per
option, then `Close`. The text ends with "reply to this message to answer in
your own words".

**Inbound flow:**

- `callback_data` is `d:<eventId>:<optionIndex>:<updatedAtSec>`, well under
  64 bytes. A stale `updatedAtSec` (the raiser edited the options after the
  message was drawn) is rejected with a toast and the message is redrawn, so an
  index can never select a different option than the one shown.
- Option button → the keyboard is replaced by `Confirm <label>` / `Back`
  (`c:` / `b:` callbacks, stateless). Confirm → `decideEvent()` with that
  option. A decision cannot be undone and the agent acts on it at once, so one
  mis-tap on a phone should not be enough.
- Text reply to an event message → looked up by (`chatId`,
  `reply_to_message.message_id`) → `decideEvent()` with `optionId: null` and
  the text as `instruction`.
- `Close` → confirm → `closeEvent()`.
- Results are reported with `answerCallbackQuery`; `conflict` becomes
  "already decided" and the message is redrawn from the current state.
- The message edit itself always comes from the bus listener, so a decision
  made in the inbox and one made in Telegram take the same path.
- When the decision stands but the wake follow-up failed (`notified: false`),
  the settled message says so and links to the inbox, where "resend" exists.

**Authorization:**

- An update is processed only when its `chat.id` equals the row's chat id;
  everything else is dropped without a reply.
- `decidedBy` is `telegram:<username or numeric id>`.
- In a group chat any member can decide. An optional per-row user allowlist is
  left out of v1 (see Annotations).

**Frontend:** `WebhookSection.tsx` gets an "interactive decisions" switch on
Telegram channels and the new `decision` event group; `kanban-api.ts`, shared
`Webhook` type, OpenAPI schemas and both i18n files follow.

**Tests** (RED first):

- `render`: text truncation, HTML escaping, callback encode/decode, stale
  `updatedAtSec`.
- `decideEvent` / `closeEvent`: the existing route tests keep passing
  unchanged; add direct tests for each `reason`.
- Poller with an injected `fetch`: foreign chat dropped, option → confirm →
  decided, reply → instruction decision, double press → conflict toast,
  redelivered update after restart is harmless, 409 backs off.
- Dispatcher: `decision.*` delivered, edits not re-announced, interactive rows
  skipped.

**Docs:** `docs/api/settings.md`, `docs/api/decisions.md`,
`docs/architecture.md`, `CLAUDE.md` (Decision Events section),
`docs/changelog.md`.

### Non-goals

- Option plus free-form instruction in one Telegram answer (use the inbox).
- Creating issues, sending follow-ups or reading logs from Telegram.
- Other chat tools in this change.
- Changes to the decision-event contract or `contractVersion`.

## Risks

- **New control surface.** With an unauthenticated API, the bot becomes a
  remote way to steer agents. The gate is the chat-id match plus the secrecy of
  the bot token; a leaked token lets an attacker read updates but not forge a
  `chat.id`, and a member of the configured group can decide.
- **One consumer per bot.** A bot that is also polled elsewhere (a dev instance
  next to production, another service, a configured webhook) returns 409. The
  poller backs off and logs; the settings UI should say that an interactive bot
  must be dedicated to one BKD instance.
- **Outbound reachability.** `api.telegram.org` must be reachable; a failure
  only delays chat delivery, the inbox keeps working.
- **Long-poll and shutdown.** A 50 s poll must abort on SIGTERM so lode's
  restart is not held up.
- **Redelivery.** After a restart the last batch can arrive twice; the atomic
  `open → decided` transition turns the duplicate into a `conflict`.
- **Message drift.** If `editMessageText` fails (message deleted, older than
  48 h for some edits), the buttons stay but every press is answered from
  current state, so the worst case is a stale-looking message.
- **Migration.** Additive only: one column with a default and one new table.

## Scope

Step 1: `packages/shared/src/index.ts`, `webhooks/dispatcher.ts`,
`openapi/schemas.ts`, `WebhookSection.tsx`, `en.json`, `zh.json`, one
dispatcher test, docs. Small.

Step 2: `db/schema.ts` + migration, `decisions/service.ts`,
`routes/decisions.ts`, new `decisions/telegram/{client,render,poller,index}.ts`,
`routes/settings/webhooks.ts`, `server-main.ts`, shared types, OpenAPI schemas,
`kanban-api.ts`, `WebhookSection.tsx`, i18n, tests, docs. Roughly 600–800 lines
including tests. No new dependency — the Bot API is four `fetch` calls.

## Alternatives

| approach | why not chosen |
|---|---|
| Telegram `setWebhook` to an inbound BKD route | Needs public HTTPS and puts an internet-facing endpoint on an API with no auth. Could be added later for hosted installs. |
| Step 1 only; the user bridges with n8n or a custom bot calling the REST API | Works and stays supported, but there is no first-party experience and every user rebuilds the same bot. |
| Separate bot process consuming SSE and calling REST | Clean isolation, but a second deployable next to a single lode-supervised artifact, with its own config and lifecycle. |
| Generic channel plugin framework now (Slack, Feishu, Matrix adapters) | One implementation does not justify the abstraction; the module surface is kept small so the interface can be extracted when a second tool arrives. |
| New `channels` table instead of extending `webhooks` | Cleaner naming, but duplicates the settings UI, CRUD routes and delivery log for the same bot token and chat id. |
| A cron-driven agent issue that relays questions | Burns engine turns on plumbing and adds latency. |

## Annotations

Approved 2026-10-13 as "implement per the plan, Telegram first": step 2 was
built first; step 1 followed on request the same day. The open points were not answered, so the
proposed defaults apply: Telegram only, long polling, any member of the
configured chat may decide, option buttons need a confirm.

Deviations from the proposal:

- The stale-button guard is a hash of the option ids, not `updatedAt`:
  timestamps are whole seconds, so an edit in the same second would have gone
  unnoticed.
- A failed wake follow-up is reported in the callback alert or the reply, not
  in the settled message: the bus event fires before the follow-up is sent.
- `events` may be empty on an interactive channel, since step 1 has no
  `decision.*` event to subscribe to yet.
- The poll loop lives in `decisions/telegram/index.ts`; there is no separate
  `poller.ts`.
- A successful text reply is acknowledged with a short message.
- Step 1 dedups each state per webhook without a time window instead of
  tracking whether an open event was already announced.

# Decision Events

A decision event is one question a coordinating agent needs the user to answer. BKD stores events, shows them in the `/decisions` inbox, and wakes the raiser once the user decides. It never creates an event itself.

Base: `/api/decisions`. A coordinator sets `BKD_EVENT_URL=$BKD_URL/api/decisions`.

States: `open → decided → applied`, `open → withdrawn`, `open | decided → closed`. A transition from any other state returns `409`. Every write emits `decision-event-updated` over SSE.

Retention: an event that is no longer `open` is removed by a daily cleanup once its last change is more than one day old, and then answers `404`. Open events are kept until they are answered, withdrawn or closed.

## GET /api/decisions

Capability probe. Call it before raising an event.

**Response:**

```json
{ "success": true, "data": { "supported": true, "contractVersion": 1 } }
```

A server without decision events answers `404`. `contractVersion` increases when the contract changes incompatibly.

## GET /api/decisions/events

List events, newest first, at most 500.

**Query:**

| Param | Type | Description |
|---|---|---|
| `campaignId` | `string` | Only events of this campaign |
| `status` | `string` | Comma-separated: `open`, `decided`, `applied`, `withdrawn`, `closed` |

**Response:** `DecisionEvent[]`

## POST /api/decisions/events

Raise an event. It starts `open`.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `campaignId` | `string` (1-200) | Yes | Groups the events of one coordination run |
| `question` | `string` (1-2000) | Yes | The question for the user |
| `notify` | `object` | Yes | Issue to wake: `{ type: "bkd-follow-up", projectId, issueId, bkdUrl? }` |
| `ref` | `string` (0-100) | No | Issue the question is about |
| `context` | `string` (0-20000) | No | Background for the user |
| `options` | `{ id, label, impact? }[]` (max 20) | No | Choices; `id` values must be unique |
| `recommendation` | `{ optionId, reason? }` | No | Must name one of `options` |
| `blocks` | `string` (0-2000) | No | What waits on the answer |
| `continues` | `string` (0-2000) | No | What carries on meanwhile |

**Response:** `201` with `DecisionEvent`. `400` when the notify issue is not in the notify project, or when `recommendation.optionId` is not one of `options`.

## GET /api/decisions/events/:id

**Response:** `DecisionEvent`, or `404`.

## PATCH /api/decisions/events/:id

Update the facts of an `open` event. Accepts `ref`, `question`, `context`, `options`, `recommendation`, `blocks`, `continues`.

**Response:** `DecisionEvent`. `409` unless the event is `open`; `400` when the resulting `recommendation.optionId` is not one of the resulting `options`.

## POST /api/decisions/events/:id/decision

The user's answer. Moves `open → decided` and sends `[event-decision eventId=… campaignId=…]` to the notify issue as a follow-up. The message is a wake signal; the raiser re-reads the event. A failed delivery leaves the event `decided` with `notifiedAt` empty.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `optionId` | `string` | One of the two | A value from `options` |
| `instruction` | `string` (0-20000) | One of the two | Free-form instruction |
| `decidedBy` | `string` (1-200) | No | Defaults to `user` |

**Response:** `DecisionEvent`

## POST /api/decisions/events/:id/notify

Resend the wake follow-up of a `decided` event.

**Response:** `DecisionEvent`. `502` when the follow-up could not be delivered.

## POST /api/decisions/events/:id/ack

The raiser records what it did. Moves `decided → applied`.

**Request Body:** `{ "outcome": "string (1-2000)" }`

## POST /api/decisions/events/:id/withdraw

The raiser retracts a question it no longer needs. Moves `open → withdrawn`.

**Request Body:** `{ "reason": "string (1-2000)" }`

## POST /api/decisions/events/:id/close

The user ends an `open` or `decided` event without answering. Sends no follow-up.

**Request Body:** `{ "reason": "string (0-2000), optional" }`

## DecisionEvent

```json
{
  "id": "…",
  "status": "open",
  "campaignId": "…",
  "ref": null,
  "question": "…",
  "context": "",
  "options": [{ "id": "a", "label": "…", "impact": "" }],
  "recommendation": { "optionId": "a", "reason": "" },
  "blocks": null,
  "continues": null,
  "notify": { "type": "bkd-follow-up", "projectId": "…", "issueId": "…" },
  "decision": null,
  "outcome": null,
  "withdrawReason": null,
  "closeReason": null,
  "notifiedAt": null,
  "links": { "projectName": null, "ref": null, "notify": null },
  "createdAt": "…",
  "updatedAt": "…"
}
```

`decision` is `{ optionId, instruction, decidedBy, decidedAt }` once decided; `decidedBy` is `telegram:<username or id>` for an answer given in Telegram; `decidedAt` is whole seconds, like every other timestamp. `links.ref` and `links.notify` are `{ issueId, projectId, issueNumber, title }` when the issue resolves.

## Notifications

Every state of an event can be sent to a notification channel (`/api/settings/webhooks`) as `decision.opened`, `decision.decided`, `decision.applied`, `decision.withdrawn` or `decision.closed`. Each state is delivered once per channel; an edit of an open event is not announced again.

A `webhook` channel receives a `POST` with `X-Webhook-Event` set to the event type and this body:

```json
{
  "event": "decision.opened",
  "timestamp": "2026-10-13T22:10:00.000Z",
  "id": "a1b2c3d4",
  "status": "open",
  "question": "…",
  "options": [{ "id": "A", "label": "…", "impact": "…" }],
  "decisionsUrl": "https://bkd.example.com/decisions",
  "apiUrl": "https://bkd.example.com/api/decisions/events/a1b2c3d4"
}
```

The body carries every field of the event as returned by `GET /events/:eventId`. `decisionsUrl` and `apiUrl` are present only when the server URL is configured in settings. The receiver answers with the routes above, for example `POST {apiUrl}/decision`; BKD does not authenticate that call, and the channel's API key is only sent outbound.

A `telegram` channel receives the same event as a text message. An interactive Telegram channel is skipped here and gets the answerable message described below.

## Answering from Telegram

A Telegram notification channel created with `interactive: true` (`POST /api/settings/webhooks`) is a second surface for the same events. It adds no route: BKD long-polls the Bot API (`getUpdates`), so nothing has to reach BKD from the internet.

- Each `open` event is posted to the chat once, with one button per option and a `Close` button. An edit by the raiser redraws the message.
- An option button asks for confirmation, then records the decision with that `optionId`.
- A reply to the event message records the reply text as `instruction`, with no option. An option together with an instruction is only possible in the inbox or over REST.
- `Close`, once confirmed, closes the event; no follow-up is sent.
- Any transition, wherever it was made, redraws the message with the result and removes the buttons.
- An answer goes through the same transition and wake follow-up as `POST …/decision`. When the follow-up cannot be delivered, the chat is told to resend from the inbox.

Only updates from the configured chat id are processed; anyone in that chat can decide. A bot allows one consumer of its updates, so an interactive bot must not be polled by another BKD instance or service, and must have no webhook set — Telegram answers `409` and BKD retries every 30 seconds.

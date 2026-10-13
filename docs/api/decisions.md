# Decision Events

A decision event is one question a coordinating agent needs the user to answer. BKD stores events, shows them in the `/decisions` inbox, and wakes the raiser once the user decides. It never creates an event itself.

Base: `/api/decisions`. A coordinator sets `BKD_EVENT_URL=$BKD_URL/api/decisions`.

States: `open → decided → applied`, `open → withdrawn`, `open | decided → closed`. A transition from any other state returns `409`. Every write emits `decision-event-updated` over SSE.

## GET /api/decisions

Capability probe. Call it before raising an event.

**Response:**

```json
{ "success": true, "data": { "supported": true, "contractVersion": 1 } }
```

A server without decision events answers `404`. `contractVersion` increases when the contract changes incompatibly.

## GET /api/decisions/events

List events, newest first.

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

**Response:** `201` with `DecisionEvent`. `400` when the notify issue is not in the notify project.

## GET /api/decisions/events/:id

**Response:** `DecisionEvent`, or `404`.

## PATCH /api/decisions/events/:id

Update the facts of an `open` event. Accepts `ref`, `question`, `context`, `options`, `recommendation`, `blocks`, `continues`.

**Response:** `DecisionEvent`. `409` unless the event is `open`.

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

`decision` is `{ optionId, instruction, decidedBy, decidedAt }` once decided. `links.ref` and `links.notify` are `{ issueId, projectId, issueNumber, title }` when the issue resolves.

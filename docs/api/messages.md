# Messages

A message is something an agent sends the user. `kind` is `decision` (one question with options) or
`notification` (a headline, a Markdown body and a `level`). BKD stores messages, shows them in the inbox drawer,
delivers them to webhook channels and wakes the sender once the user answers. It never creates one itself.

Base: `/api/messages`. This is contract version 2; [decisions.md](./decisions.md) documents the version 1 routes
kept for existing agents, which read and write the same store.

## States

| Message | States |
|---|---|
| Decision (`expects: reply`) | `open → decided → applied` |
| Notification with `expects: reply` | `open → replied → applied` |
| Either of the above | `open → withdrawn`; `open`, `decided` or `replied` `→ closed` |
| Notification with `expects: none` | `unread → read` |

An action for the other kind, or from another state, returns `409`. Every write emits `message-updated` over SSE.

Retention: the daily `message-cleanup` job removes messages in `applied`, `withdrawn` or `closed` unchanged for one
day, and read notifications unchanged for seven days. `open`, `decided`, `replied` and `unread` messages are kept.

## GET /api/messages

Capability probe.

**Response:** `{ supported: true, contractVersion: 2, kinds: ["decision", "notification"] }`

## GET /api/messages/items

List messages, newest first.

| Query Param | Type | Description |
|---|---|---|
| `kind` | `"decision" \| "notification"` | Filter by kind |
| `expects` | `"none" \| "reply"` | Filter by whether a reply is expected |
| `status` | `string` | Comma-separated statuses |
| `campaignId` | `string` | Filter by campaign |
| `issueId` | `string` | Messages whose `source` or `ref` is this issue |

**Response:** `Message[]`

`Message`: `{ id, kind, expects, status, level, campaignId, source, ref, title, body, options, recommendation,
blocks, continues, decision, reply, outcome, withdrawReason, closeReason, notifiedAt, links, createdAt, updatedAt }`.
`links` carries the project name and the issue number, title and URL of `source` and `ref`.

## POST /api/messages/items

Send a message. Returns `201`.

**Decision:**

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `"decision"` | Yes | |
| `campaignId` | `string` (1-200) | Yes | Groups the decisions of one coordination run |
| `source` | `{ projectId, issueId }` | Yes | The sending issue; it is woken when the user decides |
| `title` | `string` (1-2000) | Yes | The question |
| `body` | `string` (0-20000) | No | Context, Markdown |
| `options` | `{ id, label, impact }[]` (max 20, unique ids) | No | Choices |
| `recommendation` | `object \| null` | No | The option the sender recommends, with a reason |
| `blocks` / `continues` | `string \| null` (0-2000) | No | What waits on the answer, and what goes on meanwhile |
| `ref` | `string \| null` | No | Issue the decision is about |

**Notification:**

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `"notification"` | Yes | |
| `title` | `string` (1-2000) | Yes | Headline |
| `body` | `string` (0-20000) | No | Markdown |
| `level` | `"info" \| "success" \| "warning" \| "error"` | No | Default `info` |
| `expects` | `"none" \| "reply"` | No | Default `none` (one-way) |
| `source` | `{ projectId, issueId } \| null` | When `expects` is `reply` | The sending issue |
| `campaignId`, `ref` | `string \| null` | No | |

Notifications are limited to 30 a minute per source issue; above that the route returns `429`.

## GET /api/messages/items/:id

**Response:** `Message`

## PATCH /api/messages/items/:id

Update the facts of a message that is still awaiting a reply.

**Request Body:** `{ title?, body?, ref?, level? (notifications), options?, recommendation? (decisions), blocks?, continues? }`

## POST /api/messages/items/:id/decision

Decide an open decision and wake its source issue with `[event-decision eventId=… campaignId=…]`.

**Request Body:** `{ optionId?: string | null, instruction?: string, decidedBy?: string }` — an option, an
instruction, or both.

## POST /api/messages/items/:id/reply

Reply to an open notification and wake its source issue with `[message-reply messageId=…]`.

**Request Body:** `{ text: string (1-20000), repliedBy?: string }`

## POST /api/messages/items/:id/notify

Resend the wake follow-up of an answered message. A failed wake leaves `notifiedAt` empty.

## POST /api/messages/items/:id/ack

The sender records what it did with the answer; the message becomes `applied`.

**Request Body:** `{ outcome: string (1-2000) }`

## POST /api/messages/items/:id/withdraw

The sender withdraws an open message it no longer needs.

**Request Body:** `{ reason: string (1-2000) }`

## POST /api/messages/items/:id/close

The user ends a message without answering. No follow-up is sent.

**Request Body:** `{ reason?: string }`

## POST /api/messages/items/:id/read

Mark one notification read.

## POST /api/messages/items/read

Mark notifications read.

**Request Body:** `{ ids?: string[] }` (max 500; all unread notifications when omitted)

**Response:** `{ ids }`

## Webhooks and Telegram

Each state is announced once per subscribed channel: decisions as `decision.{opened,decided,applied,withdrawn,closed}`
with the version 1 payload, notifications as `message.{sent,replied,applied,withdrawn,closed}` with
`{ event, timestamp, message, source, ref, links, server }`. `read` is not announced. A Telegram channel created
with `interactive: true` posts every open message awaiting a reply and accepts the answer in the chat; see
[decisions.md](./decisions.md#answering-from-telegram).

# Cron

Scheduled jobs. Each job runs one action on a cron schedule. A job is paused automatically after 3 consecutive failures. Jobs are soft-deleted.

`:jobId` accepts the job ID or its name.

## GET /api/cron/actions

List the available actions and the config each one takes. Actions fall into two categories: `builtin` (upload, worktree and log cleanup) and `issue` (execute, follow-up, close, check status).

**Response:** `{ help }`

## GET /api/cron

List jobs. Deleted jobs are never returned.

| Query Param | Type | Description |
|---|---|---|
| `limit` | `number` (1-100) | Page size |
| `cursor` | `string` | Cursor from a previous page |

**Response:** `CronJob[]` without pagination params, `{ jobs, hasMore, nextCursor }` with them.

`CronJob`: `{ id, name, cron, taskType, taskConfig, enabled, lastRun, createdAt, updatedAt }`

## POST /api/cron

Create a job. It starts enabled.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` (1-100) | Yes | Unique job name |
| `cron` | `string` | Yes | Schedule expression |
| `action` | `string` | Yes | Action name from `GET /api/cron/actions` |
| `config` | `object` | No | Action-specific config |

Accepted schedule formats:

- 5 fields: `min hour dom month dow`
- 6 fields: `sec min hour dom month dow`
- `@every_<N><unit>` with unit `s`, `m`, `h` or `d`
- `@every_second`, `@every_minute`, `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`

**Response:** `201` with `CronJob`. `400` for an invalid expression or action config, `409` when the name is taken.

## DELETE /api/cron/:jobId

Soft-delete a job.

**Response:** `{ deleted: true, name }`

## GET /api/cron/:jobId/logs

Execution history of a job.

| Query Param | Type | Description |
|---|---|---|
| `status` | `"success" \| "failed" \| "running"` | Filter by result |
| `limit` | `number` (1-100) | Page size |
| `cursor` | `string` | Cursor from a previous page |

**Response:** `{ jobName, logs: [{ id, startedAt, finishedAt, durationMs, status, result, error }], hasMore, nextCursor }`

## POST /api/cron/:jobId/trigger

Run a job now and wait for it to finish.

**Response:** `{ triggered: true, name, log: { status, durationMs, result, error } }`. `409` when the job is already running.

## POST /api/cron/:jobId/pause

**Response:** `{ paused: true, name }`

## POST /api/cron/:jobId/resume

Resume a paused job, including one that was paused automatically.

**Response:** `{ resumed: true, name }`

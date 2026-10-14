# Issues

All issue routes are scoped under `/api/projects/:projectId` (except the global review endpoint).

## GET /api/projects/:projectId/issues

List issues for a project. Ordered by `isPinned` DESC, then `statusUpdatedAt` DESC. Keyset-paginated.

| Query Param | Type | Description |
|---|---|---|
| `limit` | `number` (1-200) | Page size (default 100) |
| `cursor` | `string` | Cursor from a previous page (`400` when invalid) |

**Response:** `{ success, data: Issue[], nextCursor, hasMore }` (pagination fields sit next to `data`, not inside it)

## GET /api/projects/:projectId/issues/:id

Get a single issue.

**Response:** `Issue`

## POST /api/projects/:projectId/issues

Create an issue. Auto-executes if `statusId` is `working` or `review` (review is downgraded to working). Returns `202` when auto-executing, `201` otherwise. Dispatches `issue.created` webhook.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (1-500) | Yes | Issue title (also used as initial prompt) |
| `tags` | `string[]` | No | Max 10 tags, 50 chars each |
| `statusId` | `"todo" \| "working" \| "review" \| "done"` | Yes | Initial status |
| `useWorktree` | `boolean` | No | Run in git worktree |
| `keepAlive` | `boolean` | No | Prevent idle timeout |
| `engineType` | `string` | No | Engine type (`claude-code`, `codex`, `grok`, `cursor`) or a virtual engine id. Defaults to the project's `defaultEngine`, then the global default. |
| `model` | `string` (regex: `/^[\w./:\-[\]]{1,160}$/`) | No | Model identifier |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |

**Response:** `201` or `202` with `Issue`

## PATCH /api/projects/:projectId/issues/:id

Update an issue. Status transitions trigger side effects: `working` triggers execution, `done` cancels active processes.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` (1-500) | No | Issue title |
| `tags` | `string[] \| null` | No | Tags (null to clear) |
| `statusId` | `"todo" \| "working" \| "review" \| "done"` | No | Status |
| `sortOrder` | `string` (1-50) | No | Fractional sort key |
| `isPinned` | `boolean` | No | Pin to top |
| `keepAlive` | `boolean` | No | Prevent idle timeout (synced to in-memory process immediately) |

## PATCH /api/projects/:projectId/issues/bulk

Bulk update issues. Transaction-wrapped. N+1 queries avoided via batch pre-fetch.

**Request Body:**

```json
{
  "updates": [
    { "id": "string", "statusId?": "todo|working|review|done", "sortOrder?": "string" }
  ]
}
```

Max 1000 items. Status transitions trigger execution/cancellation. Issues not owned by the project are skipped (returned in `skipped` array).

**Response:** `{ data: Issue[], skipped?: string[] }`

## DELETE /api/projects/:projectId/issues/:id

Soft-delete an issue (transaction-wrapped). Best-effort terminates active processes (5s timeout). Logs, tools, and attachments are preserved for potential restore. Dispatches `issue.deleted` webhook.

## POST /api/projects/:projectId/issues/:id/duplicate

Duplicate an issue into `todo` status. Copies title, tags, engine type, model, prompt, and user/assistant message logs. Tool call logs are not copied.

**Response:** `201` with `Issue`

## GET /api/projects/:projectId/issues/:id/export

Export issue logs as JSON file download.

| Query Param | Type | Description |
|---|---|---|
| `format` | `"json"` | Export format (currently only JSON) |

**Response:** File download (`Content-Disposition: attachment`) containing `{ issue, logs }`.

## POST /api/projects/:projectId/issues/import-session

Create an issue from a local engine session (see [sessions.md](./sessions.md)).

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `engine` | `"claude-code" \| "codex"` | Yes | Engine that owns the session |
| `sessionId` | `string` (1-200) | Yes | Session to import |
| `title` | `string` (1-500) | No | Issue title (defaults to the session title) |
| `statusId` | `"todo" \| "working" \| "review" \| "done"` | No | Initial status (default `review`) |
| `importLogs` | `boolean` | No | Copy the transcript into the issue's logs (default `true`) |

**Response:** `201` with `{ issue, importedEntries, droppedEntries, cwdMatches }`. `404` when the project or session is missing, `409` when the session is already imported.

## GET /api/issues/review

List all issues in `review` status across all projects (global, not project-scoped). Only includes issues from non-deleted projects.

**Response:** `(Issue & { projectName, projectAlias })[]`

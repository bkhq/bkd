# Local Sessions

Engine sessions recorded on this host, including ones started outside BKD. Supported engines: `claude-code`, `codex`. A session can be turned into an issue with `POST /api/projects/:projectId/issues/import-session` (see [issues.md](./issues.md)).

## GET /api/sessions

| Query Param | Type | Description |
|---|---|---|
| `engine` | `"claude-code" \| "codex"` | Only this engine |
| `search` | `string` | Text filter |
| `managed` | `"true" \| "false"` | Only sessions that are, or are not, attached to a BKD issue |
| `limit` | `number` (1-200) | Page size |
| `offset` | `number` | Rows to skip |

**Response:** `{ sessions: LocalSession[], total, hasMore }`

`LocalSession`: `{ engine, sessionId, cwd, title, lastActiveAt, sizeBytes, startedAt?, gitBranch?, cliVersion?, model?, managedByIssueId?, managedByProjectId?, matchedProjectId? }`

## GET /api/sessions/:engine/:sessionId

Preview a session transcript.

| Query Param | Type | Description |
|---|---|---|
| `limit` | `number` (1-1000) | Maximum entries to return |

**Response:** `{ session: LocalSession, entries: NormalizedLogEntry[], totalEntries }`, or `404`.

## POST /api/sessions/bulk-delete

Delete session transcripts from disk. This is **irreversible**.

**Request Body:** `{ sessions: [{ engine, sessionId }] }`

**Response:** `{ deleted: string[], failed: [{ sessionId, error }] }`

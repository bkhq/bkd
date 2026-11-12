# Issue Execution

All routes are scoped under `/api/projects/:projectId/issues/:id`.

## POST .../execute

Start execution with a new prompt. Validates working directory against workspace root (SEC-016, returns `403` if outside workspace). Automatically moves `review` issues to `working`; rejects `todo` and `done` issues.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `engineType` | `string` | Yes | Engine type (`claude-code`, `codex`, `grok`, `cursor`) or a virtual engine id, which runs on its base engine |
| `prompt` | `string` (1-32768) | Yes | Task prompt |
| `model` | `string` (regex: `/^[\w./:\-[\]]{1,160}$/`) | No | Model identifier |
| `effort` | `"auto" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"` | No | Reasoning effort for claude-code (`auto` clears it); other engines ignore it |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |

The `issue-execute` cron action starts an execution the same way.

**Response:** `{ executionId, issueId, messageId }`

## POST .../follow-up

Send a follow-up message. Accepts `application/json` or `multipart/form-data`.

**Queuing behavior:**
- `todo`/`done` issues: message is queued as pending, processed when issue starts executing
- `working` (turn in flight): message is queued until current turn finishes
- `working` (existing pending messages): message is queued behind existing pending messages
- `working` (idle) or `review`: triggers immediate follow-up
- If follow-up fails, message is saved as pending (not lost)

**Settings change restriction:** `model`, `engineType` and `effort` cannot change while the session is `running` or `pending` (returns `409`). After the first run, `engineType` may only switch between engines that share the issue's base engine (the real engine and its virtual engines); the next turn resumes the same session.

**Request Body (JSON):**

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `string` (1-32768) | Yes | Follow-up message |
| `model` | `string` (regex: `/^[\w./:\-[\]]{1,160}$/`) | No | Model override |
| `engineType` | `string` | No | Switch to another engine of the same base engine |
| `effort` | `"auto" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"` | No | Reasoning effort (`auto` clears it) |
| `permissionMode` | `"auto" \| "supervised" \| "plan"` | No | Permission mode |
| `busyAction` | `"queue" \| "cancel"` | No | What to do if agent is busy |
| `displayPrompt` | `string` (0-500) | No | Display-only prompt text (shown in UI instead of full prompt) |
| `sender` | `{ kind: "agent", projectId, issueId }` | No | The issue an agent sends from, when the user did not write the message; stored as `metadata.sender` and shown as an agent card. The issue must exist. Every engine process gets `BKD_PROJECT_ID` / `BKD_ISSUE_ID` to fill it. |

**Multipart:** same fields + `files[]` for attachments. File validation applied.

**Response:** `{ executionId, issueId, messageId, queued?: true }`

## GET .../pending

List the issue's pending (queued) messages.

**Response:** `[{ messageId, content, metadata, createdAt }]`

## DELETE .../pending

Recall a pending (queued) message. Emits `log-removed` SSE event.

| Query Param | Type | Description |
|---|---|---|
| `messageId` | `string` (ULID, 26 uppercase alphanumeric chars) | Message ID to recall |

**Response:** `{ id, content, metadata, attachments }`

Returns `404` if no matching pending message found.

## POST .../restart

Restart a failed session. Moves `review` to `working` automatically; rejects `todo` and `done`.

**Response:** `{ executionId, issueId }`

## POST .../cancel

Cancel active execution.

**Response:** `{ issueId, status }`

## POST .../terminate

Force-terminate the engine process of the issue. Use it when `cancel` does not stop the process.

**Response:** `{ issueId, status }`

## POST .../clear-session

Clear the stored engine session ID so the next run starts a fresh session instead of resuming. Useful when the session has grown too large to resume.

**Response:** `{ issueId }`

## GET .../slash-commands

Get available slash commands for the issue's engine type.

**Response:** `{ commands, agents, plugins }` where `plugins` contains `[{ name, path }]`.

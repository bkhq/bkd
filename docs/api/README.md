# BKD API Reference

Base URL: `/api`

## Response Envelope

Most JSON CRUD responses use a standard envelope. Exceptions include binary/file download endpoints (which return raw streams) and `/api/runtime` (which returns a raw object).

```json
{ "success": true, "data": T }
{ "success": false, "error": "message" }
```

## Status Codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `202` | Accepted (async operation started) |
| `400` | Bad Request (validation error) |
| `403` | Forbidden |
| `404` | Not Found |
| `409` | Conflict |
| `429` | Too Many Requests |
| `500` | Internal Server Error |

## Validation

All routes declare their request schemas with Zod through `@hono/zod-openapi`. Validation errors return `400` with comma-separated error messages. The live contract is served at `/api/docs/openapi.json`, with Swagger UI at `/api/docs`.

## Soft Deletion

Database-backed DELETE operations (projects, issues, notes, webhooks, etc.) use an `isDeleted` flag — data is never hard-deleted. Some endpoints act on disk instead: the file manager moves deleted files to a trash that is purged after 7 days, a deleted local skill moves to `data/trash/skills/`, and worktree DELETE (`/api/projects/:projectId/worktrees/:issueId`) removes the Git worktree for good.

## Security

### Headers

- **CSP**: `default-src 'self'`, inline scripts/styles allowed, frames blocked, object-src none
- **HSTS**: `max-age=31536000; includeSubDomains`
- **CORS**: Configurable via `ALLOWED_ORIGIN` env var (comma-separated origins or `*`). Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS. Credentials enabled when origin is not `*`.

### Request Protection

- Workspace root boundary validation (SEC-016); symlinks are resolved on both sides, so a link inside the workspace pointing out of it is refused
- Git command injection prevention (SEC-019)
- Workspace directory confinement (SEC-022)
- XSS prevention via `Content-Disposition: attachment` (SEC-024)
- Symlink traversal prevention via `realpath()` (SEC-025)
- Webhook URLs may target local and private-network addresses; link-local (cloud metadata) and reserved ranges are blocked

### Compression

gzip/deflate compression on all routes except SSE (`/api/events`), streaming (`*/stream`) and the file manager.

## Sections

| Document | Description |
|---|---|
| [system.md](./system.md) | Health check, status, runtime |
| [projects.md](./projects.md) | Project CRUD, archive, sort |
| [issues.md](./issues.md) | Issue CRUD, bulk update, search, duplicate, export, review |
| [execution.md](./execution.md) | Execute, follow-up, restart, cancel, slash commands |
| [logs.md](./logs.md) | Issue logs (paginated, filtered), turns |
| [changes.md](./changes.md) | Git changes and file diffs |
| [attachments.md](./attachments.md) | File attachments |
| [engines.md](./engines.md) | Engine discovery, models, model configs, virtual engines, CLI updates |
| [events.md](./events.md) | Server-Sent Events (SSE) |
| [fm.md](./fm.md) | File manager (project, worktree and skill files) |
| [terminal.md](./terminal.md) | PTY sessions, WebSocket |
| [processes.md](./processes.md) | Engine process management, capacity |
| [worktrees.md](./worktrees.md) | Git worktree management |
| [git.md](./git.md) | Git utilities |
| [filesystem.md](./filesystem.md) | Directory browsing and creation |
| [notes.md](./notes.md) | Notes CRUD |
| [messages.md](./messages.md) | Decisions and notifications sent by agents (contract v2) |
| [decisions.md](./decisions.md) | Decision events (contract v1, same store) |
| [skills.md](./skills.md) | Agent skills: list, create, copy, upload, CLI operations |
| [settings.md](./settings.md) | System settings, webhooks, cleanup, upgrade |
| [cron.md](./cron.md) | Scheduled jobs |
| [sessions.md](./sessions.md) | Local engine sessions |

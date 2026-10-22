# Architecture

## Overview

BKD is a Kanban application for managing autonomous AI coding agents. Issues on the board are assigned to CLI-based AI engines (Claude Code, Codex, Grok Build, Cursor) that execute in the user's workspace. The system handles process orchestration, streaming log aggregation, real-time SSE updates, cron scheduling, and decision events; upgrades are driven by the [lode](https://github.com/bkhq/lode) supervisor.

**Deployment assumption:** BKD is currently designed as a single-user application. The backend, frontend, SSE event model, workspace access model, and settings surface assume one trusted operator per deployment. It is not currently designed as a multi-tenant or per-project-isolated system for mutually untrusted users. This assumption is especially important for features such as the global SSE stream, shared process visibility, workspace browsing, and settings management. If BKD is extended to support multi-user deployments in the future, server-side authorization boundaries will need to be added explicitly.

**Bun Workspaces monorepo** with four packages:

| Package | Name | Purpose |
|---------|------|---------|
| `apps/api` | `@bkd/api` | Bun/Hono backend server |
| `apps/frontend` | `@bkd/frontend` | React/Vite frontend SPA |
| `packages/shared` | `@bkd/shared` | Shared TypeScript types |
| `packages/tsconfig` | `@bkd/tsconfig` | Shared TS configs (base, hono, react, utils) |

**Dependency flow:** `@bkd/api` and `@bkd/frontend` both depend on `@bkd/shared`. Shared versions managed via Catalogs in root `package.json`.

---

## Backend (`apps/api/src/`)

### Runtime & Server

- **Runtime**: Bun with `Bun.serve()` (`idleTimeout: 60`, WebSocket support)
- **Router**: Hono mounted at `/api` via `app.ts`
- **Logging**: pino (structured HTTP request logging)
- **Caching**: In-process LRU+TTL Map (max 500 entries, 5-min sweep)
- **Static serving**: `APP_DIR/public/` (package), `apps/frontend/dist/` (dev)

### Middleware (`app.ts`)

1. `secureHeaders()` — security response headers
2. `compress()` — gzip/deflate (skipped for SSE routes)
3. `httpLogger()` — pino-based request logging
4. Global error handler — returns `{ success: false, error }` envelope
5. `@hono/zod-openapi` — shared Zod request schemas and the REST contract (`/api/docs/openapi.json`, Swagger UI at `/api/docs`); multipart handlers validate the same schemas explicitly

### Database (`db/`)

SQLite via `bun:sqlite` + Drizzle ORM. WAL mode, foreign keys, 64 MB cache, 256 MB mmap, `busy_timeout=15000`. Migrations auto-apply on startup.

**Migration source resolution** (`db/migrations-source.ts`, side-effect free, shared by startup and repair): package mode → `APP_DIR/migrations`; dev → `apps/api/drizzle`; compiled binary → embedded map materialized to a temp dir.

**Database repair (`bkd fix-db` / `bkd --fix-db`):** the main entry (`index.ts`) checks argv first and, on the fix-db path, dynamically imports `db/repair.ts` only — the server bootstrap (`server-main.ts`) and its migrate+`verifySchema()` side-effect never load, so repair works even when normal startup would `process.exit(1)`. `db/repair.ts` re-applies pending migrations idempotently (hash-tracked via `__drizzle_migrations`), tolerant per-statement of "already exists" / "duplicate column name", recovering DBs whose migration history is hash-inconsistent (the cause of unapplied late migrations such as the `default_engine`/`default_model` columns). Stop the server before running it.

**ID conventions:** `shortId()` (8-char nanoid) for projects/issues; `id()` (ULID) for logs/attachments/tool calls.

**Tables:**

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `projects` | `id`, `name`, `alias` (unique), `directory`, `repositoryUrl`, `systemPrompt`, `envVars`, `defaultEngine`, `defaultModel` | Top-level container; supports archive; per-project engine/model defaults inherit global when null |
| `issues` | `id`, `projectId`, `statusId`, `issueNumber`, `title`, `tags`, `parentIssueId`, `useWorktree`, `isPinned`, `keepAlive`, `engineType`, `sessionStatus`, `model`, `externalSessionId`, `totalInputTokens`, `totalOutputTokens`, `totalCostUsd` | Core entity; CHECK constraint on status |
| `issueLogs` | `id` (ULID), `issueId`, `turnIndex`, `entryIndex`, `entryType`, `content`, `metadata`, `visible` | Conversation log entries |
| `issuesLogsToolsCall` | `id` (ULID), `logId`, `issueId`, `toolName`, `toolCallId`, `kind`, `isResult`, `raw` | Tool action detail records |
| `attachments` | `id` (ULID), `issueId`, `logId`, `originalName`, `storedName`, `mimeType`, `size` | File uploads |
| `appSettings` | `key` (PK), `value` | Key-value store for server config |
| `notes` | `id` (ULID), `title`, `content`, `isPinned` | User notes |
| `messages` | `id`, `kind`, `expects`, `status`, `level`, `campaignId`, `source`, `ref`, `title`, `body`, `options`, `decision`, `reply` | Decisions and notifications sent by agents |
| `messageChannelMessages` | `id` (ULID), `webhookId`, `messageId`, `chatId`, `chatMessageId` | Telegram chat message carrying a message |
| `webhooks` | `id` (ULID), `channel`, `url`, `secret`, `events`, `isActive` | Webhook endpoints |
| `webhookDeliveries` | `id`, `webhookId`, `dedupKey`, `statusCode`, `success`, `duration` | Delivery audit trail |
| `cronJobs` | `id`, `name`, `cron`, `taskType`, `taskConfig`, `enabled` | Scheduled jobs |
| `cronJobLogs` | `id`, `jobId`, `status`, `result`, `error`, `durationMs` | Job execution logs |

All tables share `commonFields`: `createdAt`, `updatedAt`, `isDeleted` (soft delete).

### Statuses (`config.ts`)

Hardcoded constants — no DB table:

| Status | Color | Sort |
|--------|-------|------|
| `todo` | `#6b7280` | 0 |
| `working` | `#3b82f6` | 1 |
| `review` | `#f59e0b` | 2 |
| `done` | `#22c55e` | 3 |

### API Routes (`routes/`)

**Issue routes** (all project-scoped under `/api/projects/:projectId/`):

| Route | Methods | File | Description |
|-------|---------|------|-------------|
| `/api/projects` | GET, POST | `projects.ts` | List/create projects |
| `/api/projects/:id` | GET, PATCH, DELETE | `projects.ts` | Get/update/soft-delete project |
| `/api/.../issues` | GET, POST | `issues/query.ts`, `create.ts` | List/create issues |
| `/api/projects/:id/{archive,unarchive}` | POST | `projects.ts` | Archive state |
| `/api/projects/sort` | PATCH | `projects.ts` | Reorder projects |
| `/api/projects/:id/worktrees[/:issueId]` | GET, DELETE | `worktrees.ts` | Worktree management |
| `/api/.../issues/bulk` | PATCH | `issues/update.ts` | Bulk update status/sort |
| `/api/.../issues/import-session` | POST | `issues/import-session.ts` | Create an issue from a local engine session |
| `/api/.../issues/:id` | GET, PATCH, DELETE | `issues/query.ts`, `update.ts`, `delete.ts` | Single issue CRUD |
| `/api/.../issues/:id/execute` | POST | `issues/command.ts` | Start AI engine execution |
| `/api/.../issues/:id/follow-up` | POST | `issues/message.ts` | Follow-up (JSON or multipart with attachments) |
| `/api/.../issues/:id/pending` | GET, DELETE | `issues/message.ts` | List / recall queued messages |
| `/api/.../issues/:id/{restart,cancel,terminate,clear-session}` | POST | `issues/command.ts` | Session control |
| `/api/.../issues/:id/slash-commands` | GET | `issues/command.ts` | Slash commands of the issue's engine |
| `/api/.../issues/:id/logs` | GET | `issues/logs.ts` | Paginated logs (cursor-based) |
| `/api/.../issues/:id/logs/filter/*` | GET | `issues/logs.ts` | Filtered logs (path key/value) |
| `/api/.../issues/:id/attachments/:attachmentId` | GET | `issues/attachments.ts` | Download an attachment (uploads go through create / follow-up multipart) |
| `/api/.../issues/:id/changes[/file]` | GET | `issues/changes.ts` | Git change summary, per-file diff |
| `/api/.../issues/:id/duplicate` | POST | `issues/duplicate.ts` | Clone issue |
| `/api/.../issues/:id/export` | GET | `issues/export.ts` | Export as JSON |
| `/api/issues/review` | GET | `issues/review.ts` | Global review queue |

**System routes:**

| Route | Methods | File | Description |
|-------|---------|------|-------------|
| `/api`, `/api/health`, `/api/status`, `/api/runtime` | GET | `api.ts` | Status, DB health + version, runtime info |
| `/api/engines/*` | GET, POST, PATCH, PUT | `engines.ts` | Engine discovery, models, settings, virtual engines, usage, probe |
| `/api/events` | GET | `events.ts` | Global SSE endpoint |
| `/api/settings/*` | GET, POST, PATCH, PUT, DELETE | `settings/` | App settings, webhooks, cleanup, system logs, upgrade |
| `/api/terminal/*`, `/api/terminal/ws/:id` | GET, POST, DELETE, WS | `terminal.ts` | PTY sessions, WebSocket terminal |
| `/api/files/:root/*` | GET, PUT, POST, DELETE | `files.ts` | File browser: list, read, save, upload, delete |
| `/api/filesystem/dirs` | GET, POST | `filesystem.ts` | Directory listing / creation |
| `/api/git/detect-remote` | POST | `git.ts` | Remote URL detection |
| `/api/processes/*` | GET, POST | `processes.ts` | Active engine processes, capacity, terminate |
| `/api/sessions/*` | GET, POST | `sessions.ts` | Local engine sessions (list, preview, bulk delete) |
| `/api/cron/*` | GET, POST, DELETE | `cron.ts` | Cron job management |
| `/api/notes/*` | GET, POST, PATCH, DELETE | `notes.ts` | Notes CRUD |
| `/api/messages[/items/*]` | GET, POST, PATCH | `messages.ts` | Capability probe; messages: send, decide, reply, read, notify, ack, withdraw, close |
| `/api/decisions[/events/*]` | GET, POST, PATCH | `decisions.ts` | v1 decision-event contract over the messages store |

### Engine System (`engines/`)

The most complex subsystem — bridges API routes and CLI-based AI agents.

#### Engine Types & Protocols

| Engine | Protocol | CLI | Behavior |
|--------|----------|-----|----------|
| `claude-code` | `stream-json` | `claude` binary | Streaming JSON over stdout; process exits after each turn |
| `codex` | `json-rpc` | `codex app-server` | JSONL JSON-RPC over stdio; process **stays alive** between turns |
| `grok` | `stream-json` | `grok -p` (Grok Build) | `streaming-messages-json` over stdout, one prompt per process; follow-up resumes with `-r`, cancel is SIGTERM |
| `cursor` | `stream-json` | `cursor-agent -p` (Cursor CLI) | `stream-json` over stdout, one prompt per process; `--resume <id>` creates or resumes the session, cancel is SIGTERM |

Each executor implements `EngineExecutor`: `spawn`, `spawnFollowUp`, `cancel`, `getAvailability`, `getModels`, `normalizeLog`.

#### Directory Structure

```
engines/
├── types.ts                    — Core types, EngineExecutor interface
├── process-manager.ts          — Generic subprocess lifecycle manager
├── startup-probe.ts            — Engine discovery (3-tier cache)
├── reconciler.ts               — Stale session cleanup safety net
├── spawn.ts                    — node:child_process wrapper
├── engine-store.ts             — Executor registry
├── executors/
│   ├── claude/
│   │   ├── executor.ts         — Main Claude Code executor
│   │   ├── protocol.ts         — Stream-JSON protocol handler
│   │   ├── normalizer.ts       — Log normalization
│   │   ├── normalizer-types.ts — Type definitions
│   │   └── normalizer-tool.ts  — Tool call parsing
│   ├── codex/
│   │   ├── executor.ts         — Codex executor (long-lived process)
│   │   ├── protocol.ts         — JSON-RPC protocol handler
│   │   └── normalizer.ts       — Log normalization (most complex)
│   ├── grok/
│   │   ├── executor.ts         — Grok Build headless executor
│   │   └── normalizer.ts       — Log normalization (self-contained)
│   ├── cursor/
│   │   ├── executor.ts         — Cursor CLI headless executor
│   │   └── normalizer.ts       — Log normalization (self-contained)
└── issue/
    ├── engine.ts               — IssueEngine singleton facade
    ├── orchestration/          — execute, follow-up, restart, cancel
    ├── lifecycle/              — spawn, completion, settlement
    ├── streams/                — Async stdout consumer, log classification
    ├── persistence/            — DB writes for logs + tool calls
    ├── pipeline/               — Token aggregation, failure detection
    ├── state/                  — State machine actions
    ├── process/                — Per-issue lock (chained Promises)
    ├── store/                  — Execution store, message rebuilder
    └── utils/                  — Worktree, visibility, normalizer factory
```

#### Process Manager (`process-manager.ts`)

Generic `ProcessManager<TMeta>` for subprocess lifecycle:

- State machine: `spawning → running → completed/failed/cancelled`
- Groups processes by issue ID; supports `terminateGroup()`
- Graceful interrupt → SIGKILL after 5s timeout
- Auto-cleanup of terminal entries after 5 min; GC sweep every 10 min

#### Issue Engine Layer (`engines/issue/`)

`IssueEngine` singleton — orchestration facade between routes and executors:

```
Route handler → IssueEngine.executeIssue() → acquires per-issue lock
  → updates DB (sessionStatus='running') → executor.spawn() → ProcessManager.register()
  → consumeStream() (async generator over stdout) → persistence/ (DB) + events/ (SSE)
  → monitorCompletion() → settleIssue() (status → 'review')
```

#### State Axes

| Axis | Field | Values | Owner |
|------|-------|--------|-------|
| Board workflow | `issues.statusId` | `todo`, `working`, `review`, `done` | Routes + reconciler |
| Session lifecycle | `issues.sessionStatus` | `pending`, `running`, `completed`, `failed`, `cancelled` | IssueEngine |
| Subprocess | ProcessManager state | `spawning`, `running`, `completed`, `failed`, `cancelled` | ProcessManager |

#### Concurrency Control

- **Per-issue mutex** (`withIssueLock`): Promise-chain lock keyed by `issueId`, queue depth cap (10), acquire timeout (30s), execution timeout (120s)
- **Probe dedup** (`startup-probe.ts`): `probeInFlight` ensures concurrent callers share one probe

#### Reconciler (`reconciler.ts`)

Safety net for stale sessions:
- **Startup**: marks `running`/`pending` sessions as `failed`; moves orphaned `working` issues to `review`
- **Periodic**: every 60s
- **Event-driven**: 1s after each issue settlement

#### Engine Discovery (`startup-probe.ts`)

Three-tier caching: memory (10 min) → DB (`appSettings`) → live probe (15s timeout, parallel).

### Cron System (`cron/`)

Powered by `cronbake` scheduler:

- **Built-in jobs**: `upload-cleanup` (hourly), `log-cleanup`, `worktree-cleanup` (30 min), `issue-log-retention`, `message-cleanup` (daily)
- **Issue jobs**: `issue-execute`, `issue-follow-up`, `issue-close`, `issue-check-status`
- Tables: `cronJobs` + `cronJobLogs`
- Jobs are addressed by ID only; a job auto-pauses after 3 consecutive failures

### Messages (`messages/`)

A message is something an agent sends the user. `kind` is `decision` (one question with options) or `notification` (headline, Markdown body, `level`). BKD is the platform only: it stores messages, shows them, delivers them, and wakes the sender — it never creates one itself.

- Contract: `skills/bkd/references/decisions.md` in `zzci/skills` (v1, decisions only) and its v2 successor. `GET /api/messages` is the v2 probe: `{ supported: true, contractVersion: 2, kinds: ['decision', 'notification'] }`. `GET /api/decisions` keeps answering the v1 probe `{ supported: true, contractVersion: 1 }`.
- `expects`: `reply` for every decision; a notification picks `none` (one-way, `unread → read`) or `reply` (needs a `source` issue, `open → replied → applied`).
- States for messages awaiting a reply: `open → decided | replied → applied`, `open → withdrawn`, and `open | answered → closed`. A transition from any other state, or an action for the other kind, returns 409.
- Answering: `decision` (an option, an instruction, or both) or `reply` (free text). BKD then follows up the `source` issue through `dispatchFollowUp()` — the same routing the follow-up route uses — with `[event-decision eventId=… campaignId=…]` for decisions and `[message-reply messageId=…]` for notifications. The message is a wake signal; the sender re-reads the message. A failed delivery leaves `notifiedAt` empty, and `POST /items/:id/notify` resends it.
- `close` (user) ends a message without answering it and sends no follow-up. `ack` and `withdraw` belong to the sender.
- Notifications are limited to 30 a minute per source issue (in-memory window, 429 above it).
- Every write emits `message-updated` on the event bus and over SSE.
- `webhooks/dispatcher.ts` turns `message-updated` into notification events, one delivery per state and channel. Decisions keep the `decision.*` events and the v1 payload (serialized event plus `decisionsUrl` / `apiUrl`). Notifications use `message.{sent,replied,applied,withdrawn,closed}` (`read` is silent) with `{ event, timestamp, message, source, ref, links: { inboxUrl, apiUrl }, server: { url, version } }`, where `source` / `ref` carry the issue number, title, project, engine, model and issue URL. Messages are never targeted at a channel; every subscribed channel receives them. Interactive Telegram channels are skipped for messages awaiting a reply.
- `messages/telegram/` is a second answering surface. A Telegram notification channel with `webhooks.interactive` set gets each open message awaiting a reply — decisions with option buttons, notifications with a close button; `index.ts` listens to `message-updated` to post and redraw, and runs one `getUpdates` long-poll loop per bot token for button presses and replies. Answers call `decideMessage()` / `replyMessage()` in `messages/service.ts`, the same path as the REST routes. `message_channel_messages` maps a message to the chat message that carries it. Updates from any chat other than the configured one are dropped.
- v1 alias: `routes/decisions.ts` serves `/api/decisions/*` from the same table restricted to `kind = 'decision'`, projected to the v1 shape by `messages/v1.ts`. It is in-process, not an HTTP redirect.
- Migration `0029`–`0031` copied `decision_events` / `decision_channel_messages` into the new tables with ids preserved, renamed the `decision-event-cleanup` cron job, and dropped the old tables.
- Retention: the `message-cleanup` cron action soft-deletes messages in a terminal state (`applied`, `withdrawn`, `closed`) untouched for a day, and read notifications untouched for seven days. Open, answered (`decided` / `replied`) and unread messages are never removed, so an answer the sender has not acted on stays readable.

### Event System (`events/`)

**SSE endpoint** (`GET /api/events`) — single global stream via Hono `streamSSE`:

**Single-user assumption:** `/api/events` is intentionally implemented as one global event stream with client-side filtering. This is an explicit tradeoff under the current single-user deployment model, where all visible issue activity belongs to the same trusted operator. It should not be interpreted as a multi-user authorization boundary.

- Event types: `log`, `log-updated`, `log-removed`, `state`, `done`, `issue-updated`, `changes-summary`, `message-updated`, `heartbeat` (15s)
- Subscribes to: `IssueEngine.onLog`, `.onStateChange`, `.onIssueSettled`, `onIssueUpdated`, `onChangesSummary`, and the `message-updated` bus event

**`changes-summary.ts`**: runs `git status/diff` after each issue settles; pushes file change stats via SSE.

### Upgrade (`upgrade/`)

BKD does not update itself. It runs as a child of the [lode](https://github.com/bkhq/lode) supervisor, which fetches `bkd-server.tar.gz` from GitHub Releases, verifies it, installs it under `<dir>/versions/<version>/`, and restarts BKD, rolling back if the new version fails its health grace.

- `lode-sdk.ts` — vendored from `bkhq/lode`
- `service.ts` — reads lode's `state.json` and writes the request fields the app owns (`target`, `restart_nonce`, `ready`)
- `/api/settings/upgrade/*` exposes version, status, check, update, rollback, and restart; update policy lives in `lode.toml`

See `docs/deployment.md`.

### Webhook System (`webhooks/`)

- Channels: `webhook` (HTTP POST) and `telegram` (bot API)
- Events: issue status changes, session state changes
- Delivery audit trail in `webhookDeliveries` table
- Deduplication via `dedupKey`

---

## Frontend (`apps/frontend/src/`)

### Stack

- **Framework**: React 19 + Vite 8 + TypeScript
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn/ui components
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Server state**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **Local UI state**: Zustand stores
- **Drag & drop**: @dnd-kit/core + @dnd-kit/sortable for issue drag on the kanban board and list panel (`components/issue-drag/`); @atlaskit/pragmatic-drag-and-drop only for HomePage project ordering
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **Terminal**: xterm.js 6.0 + WebSocket
- **i18n**: i18next + react-i18next (Chinese default, English)
- **Path alias**: `@/*` → `src/*`
- **Dev URL routing**: `nsl run` wraps both servers so `http://bkd.localhost/api/*` reaches the API and the rest reaches Vite; Vite has no `/api/*` proxy

### Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | `HomePage` | Project dashboard |
| `/projects/:projectId` | `KanbanPage` | Kanban board with drag-and-drop |
| `/projects/:projectId/issues[/:issueId]` | `IssueDetailPage` | Three-panel: list + chat + diff |
| `/review[/:projectId/:issueId]` | `ReviewPage` | Review queue |
| `/terminal` | `TerminalPage` | Full-page terminal |
| `/cron` | `CronPage` | Cron job management |
| `/messages` | `MessagesPage` | Global inbox for decisions and notifications (`/decisions` redirects here) |
| `/sessions` | `SessionsPage` | Local engine sessions |

Four global drawers (lazy-mounted): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`, `NotesDrawer`.

### Component Architecture

```
components/
├── ui/              ← shadcn/ui primitives (25+ components)
├── kanban/          ← Board: columns, cards, sidebar, create dialog, header
├── issue-detail/    ← Chat area, log entries, tool items, diff panel, markdown
├── files/           ← File browser: breadcrumbs, directory listing, file viewer
├── terminal/        ← xterm.js WebSocket terminal
├── processes/       ← Active engine process list
├── notes/           ← Notes drawer and editor
└── settings/        ← Webhook, cleanup, upgrade settings
```

### State Management

**React Query** — all server state. Query key factory (`queryKeys`) covers projects, issues, changes, engines, settings, cron, etc.

**Zustand stores** — pure client UI state:

| Store | State |
|-------|-------|
| `panel-store` | Side panel open/closed, width, create dialog |
| `view-mode-store` | Kanban/list toggle (persisted in localStorage) |
| `terminal-store` | Terminal drawer state |
| `terminal-session-store` | xterm.js instance, WebSocket, session ID |
| `file-browser-store` | File browser drawer, current path |
| `process-manager-store` | Process manager drawer |
| `notes-store` | Notes drawer state |
| `server-store` | Server name, URL |
| `chat-filter-store` | Chat entry-type filter |
| `session-panel-store` | Local session panel state |

### Real-Time Data Flow

```
Server (IssueEngine)
    ↓
SSE /api/events
    ↓
EventBus singleton (lib/event-bus.ts)
    ├── log events     → useIssueStream() → liveLogs (capped 500, ULID dedup)
    ├── state events   → sessionStatus update
    ├── done events    → React Query invalidation
    ├── issue-updated  → projects/issues query invalidation
    └── changes-summary → useChangesSummary()
```

**EventBus**: single `EventSource` with exponential backoff reconnection and 35s heartbeat watchdog. On reconnect: invalidates all queries.

**useIssueStream**: fetches historical logs via HTTP, subscribes to SSE for real-time. Two arrays: `liveLogs` (capped 500) and `olderLogs` (pagination). ULID dedup.

### API Client (`lib/kanban-api.ts`)

Typed async functions wrapping all backend endpoints. Internal helpers (`get`, `post`, `patch`, `del`, `postFormData`) parse `{ success, data, error }` envelope.

---

## Shared Types (`packages/shared/`)

Single source of truth consumed by both backend and frontend:

- **Domain**: `Project`, `Issue`, `EngineType`, `SessionStatus`, `PermissionMode`, `BusyAction`
- **Logs**: `NormalizedLogEntry`, `LogEntryType`, `ChatMessage` (8 variants), `ToolAction`, `ToolDetail`
- **Engine**: `EngineAvailability`, `EngineModel`, `EngineDiscoveryResult`, `EngineProfile`, `ProbeResult`
- **API**: `ApiResponse<T>`, `ExecuteIssueRequest`, `IssueLogsResponse`, `IssueChangesResponse`
- **Files**: `FileEntry`, `DirectoryListing`, `FileContent`
- **Processes**: `ProcessInfo`, `ProjectProcessesResponse`

Frontend re-exports via `types/kanban.ts`.

---

## Build & Distribution

### Release Artifact

`bun run package` (`scripts/package.ts`) is the only distributable: it builds the frontend, bundles the server into `server.js`, and creates `bkd-server.tar.gz` (~2 MB) containing `server.js`, `public/`, `migrations/`, and `version.json`. lode installs and runs it; `scripts/migrate-to-lode.ts` moves a pre-lode install onto lode. See `docs/deployment.md`.

### CI/CD (`.github/workflows/`)

| Workflow | Purpose |
|----------|---------|
| `ci.yml` | Lint, typecheck, migration drift check, tests, frontend build |
| `release.yml` | Build the package and publish the GitHub Release |

### Database Migrations

28 migrations in `apps/api/drizzle/` (0000–0027). Auto-applied on startup in `meta/_journal.json` order. Sources: `apps/api/drizzle` (dev), `APP_DIR/migrations/` (package), or the embedded map (`db/embedded-migrations.ts`, used only when no filesystem migrations exist).

---

## Key Architectural Patterns

1. **API response envelope**: `{ success: true, data: T } | { success: false, error: string }`
2. **Soft deletion**: all entities use `isDeleted` flag, never hard-deleted
3. **Per-issue operation lock**: chained Promises prevent concurrent execute/follow-up/restart
4. **Optimistic UI**: drag-and-drop uses board store for immediate feedback; sync pauses during drag
5. **Three-tier engine discovery cache**: memory → DB → live probe
6. **Event-driven invalidation**: SSE events trigger targeted React Query cache invalidation
7. **Pending message coalescence**: messages queued while AI is busy merge into single follow-up on exit
8. **Reconciliation**: startup + periodic + event-driven safety net for orphaned sessions
9. **Immutable session IDs**: `externalSessionId` enables session continuity across follow-ups
10. **Auto-retry**: failed sessions retry up to max limit

---

## Deployment Constraints

- **Single instance**: in-memory state (process manager, caches) does not replicate
- **Stateful**: subprocess tracking requires stable PID space
- **SQLite**: excellent for single-machine, not horizontally scalable for writes
- **Long-lived processes**: Codex engine keeps processes alive between turns

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono |
| Database | SQLite + Drizzle ORM |
| Frontend | React 19 + Vite 8 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Drag & Drop | @dnd-kit (issues), @atlaskit/pragmatic-drag-and-drop (HomePage projects) |
| Terminal | xterm.js 6.0 |
| Syntax | Shiki 4.0 |
| Cron | cronbake |
| i18n | i18next |
| Linting | @antfu/eslint-config |
| AI Engines | Claude Code, OpenAI Codex, Grok Build, Cursor CLI |
| Supervisor | lode |

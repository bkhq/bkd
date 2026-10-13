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
| `decisionEvents` | `id`, `status`, `campaignId`, `ref`, `question`, `options`, `notify`, `decision` | Decision events raised by coordinating agents |
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
| `/api/decisions[/events/*]` | GET, POST, PATCH | `decisions.ts` | Capability probe; decision events: raise, decide, ack, withdraw, close |

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

- **Built-in jobs**: `upload-cleanup` (hourly), `log-cleanup`, `worktree-cleanup` (30 min), `issue-log-retention`, `decision-event-cleanup` (daily)
- **Issue jobs**: `issue-execute`, `issue-follow-up`, `issue-close`, `issue-check-status`
- Tables: `cronJobs` + `cronJobLogs`
- Jobs are addressed by ID only; a job auto-pauses after 3 consecutive failures

### Decision Events (`decisions/`)

A decision event is one question a coordinating agent needs the user to answer. BKD is the platform only: it stores events, shows them, and wakes the raiser — it never creates one itself.

- Contract: `skills/bkd/references/decision-events.md` in `zzci/skills`. A coordinator sets `BKD_EVENT_URL=$BKD_URL/api/decisions` and calls `/events/...` as written there. The mount point avoids `GET /api/events`, which is the SSE stream.
- `GET /api/decisions` is the capability probe: `{ supported: true, contractVersion: 1 }`. A server without decision events answers 404.
- States: `open → decided → applied`, `open → withdrawn`, and `open | decided → closed`. A transition from any other state returns 409.
- `decision` (user): an option, a free-form instruction, or both. BKD then sends `[event-decision eventId=… campaignId=…]` to the `notify` issue through `dispatchFollowUp()` — the same routing the follow-up route uses. The message is a wake signal; the raiser re-reads the event. A failed delivery leaves the event `decided` with `notifiedAt` empty, and `POST /events/:id/notify` resends it.
- `close` (user) ends an event without answering it and sends no follow-up. It is an extension of the skill contract.
- `ack` and `withdraw` belong to the raiser.
- Every write emits `decision-event-updated` on the event bus and over SSE.
- Retention: the `decision-event-cleanup` cron action soft-deletes every non-open event whose `updatedAt` is more than one day old. Open events are never removed.

### Event System (`events/`)

**SSE endpoint** (`GET /api/events`) — single global stream via Hono `streamSSE`:

**Single-user assumption:** `/api/events` is intentionally implemented as one global event stream with client-side filtering. This is an explicit tradeoff under the current single-user deployment model, where all visible issue activity belongs to the same trusted operator. It should not be interpreted as a multi-user authorization boundary.

- Event types: `log`, `log-updated`, `log-removed`, `state`, `done`, `issue-updated`, `changes-summary`, `decision-event-updated`, `heartbeat` (15s)
- Subscribes to: `IssueEngine.onLog`, `.onStateChange`, `.onIssueSettled`, `onIssueUpdated`, `onChangesSummary`, and the `decision-event-updated` bus event

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
- **Drag & drop**: @atlaskit/pragmatic-drag-and-drop
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
| `/decisions` | `DecisionsPage` | Global decision inbox |
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
| `board-store` | Grouped items by status, `isDragging` (pauses server sync) |
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

27 migrations in `apps/api/drizzle/` (0000–0026). Auto-applied on startup in `meta/_journal.json` order. Sources: `apps/api/drizzle` (dev), `APP_DIR/migrations/` (package), or the embedded map (`db/embedded-migrations.ts`, used only when no filesystem migrations exist).

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
| Drag & Drop | @atlaskit/pragmatic-drag-and-drop |
| Terminal | xterm.js 6.0 |
| Syntax | Shiki 4.0 |
| Cron | cronbake |
| i18n | i18next |
| Linting | @antfu/eslint-config |
| AI Engines | Claude Code, OpenAI Codex, Grok Build, Cursor CLI |
| Supervisor | lode |

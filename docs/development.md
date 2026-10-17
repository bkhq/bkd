# Development Guide

## Quick Start

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies (also installs the nsl dev-URL proxy as @dotns/nsl)
bun install

# Configure environment
cp .env.example .env

# Start the nsl proxy daemon once (enables http://bkd.localhost routing)
bunx nsl start

# Start dev servers (API + Vite, both fronted by nsl, which assigns their ports)
bun run dev
```

Open `http://bkd.localhost` — nsl routes `/api/*` to the backend and everything else to Vite (`nsl list` shows the assigned ports). This is the only dev entry point; Vite has no `/api/*` proxy, so the Vite port alone will not reach the API.

## Scripts

```bash
# Development (each `dev` script is wrapped in `nsl run` to register
# the server at http://bkd.localhost; see Quick Start above)
bun run dev              # API + frontend in parallel
bun run dev:api          # API only (route bkd.localhost/api)
bun run dev:frontend     # Frontend only (route bkd.localhost/)

# Code Quality
bun run lint             # ESLint check (linting + formatting, all workspaces)
bun run lint:fix         # ESLint auto-fix
bun run format           # Same as lint:fix (formatting is handled by ESLint stylistic rules)
bun run typecheck        # tsc --noEmit in every workspace (TS 7; see CLAUDE.md)

# Testing
bun run test             # All tests (parallel)
bun run test:api         # Backend tests only (bun:test)
bun run test:frontend    # Frontend tests only (vitest)

# Run a single test file
cd apps/api && bun test --preload ./test/preload.ts test/api-issues.test.ts
cd apps/frontend && bunx vitest run src/__tests__/lib/format.test.ts

# Database
bun run db:generate      # Generate migration SQL (drizzle-kit)
bun run db:migrate       # Apply migrations
bun run db:reset         # Delete SQLite DB files

# Production Build
bun run build            # Build frontend (Vite -> apps/frontend/dist/)
bun run start            # Production server (port 3000)

# Release artifact (the only distributable; lode installs and runs it, see docs/deployment.md)
bun run package                      # Build frontend + bundle server -> bkd-server.tar.gz (~2 MB)
bun scripts/package.ts --version 0.0.7 --outfile bkd-server.tar.gz --skip-frontend
```

## Tech Stack

| Layer    | Technology                                                                      |
| -------- | ------------------------------------------------------------------------------- |
| Runtime  | [Bun](https://bun.sh)                                                           |
| Backend  | [Hono](https://hono.dev)                                                        |
| Database | SQLite + [Drizzle ORM](https://orm.drizzle.team)                                |
| Frontend | React 19 + [Vite](https://vite.dev) 8                                           |
| Styling  | [Tailwind CSS](https://tailwindcss.com) v4 + [shadcn/ui](https://ui.shadcn.com) |
| DnD      | [@dnd-kit/core + sortable](https://dndkit.com) (issues), pragmatic-drag-and-drop (projects) |
| Terminal | [xterm.js](https://xtermjs.org)                                                 |
| i18n     | [i18next](https://www.i18next.com)                                              |
| Linting  | [@antfu/eslint-config](https://github.com/antfu/eslint-config) (ESLint + stylistic) |

## Project Structure

```
bkd/
├── apps/
│   ├── api/                      ← @bkd/api (backend)
│   │   ├── src/
│   │   │   ├── index.ts          ← Server entry (Bun.serve, static serving)
│   │   │   ├── app.ts            ← Hono router + middleware
│   │   │   ├── config.ts         ← Hardcoded statuses (todo/working/review/done)
│   │   │   ├── db/               ← SQLite/Drizzle schema + migrations
│   │   │   ├── engines/          ← AI engine executors + process management
│   │   │   ├── routes/           ← API routes
│   │   │   ├── events/           ← SSE event system
│   │   │   ├── cron/             ← Cron scheduler + actions (built-in cleanup jobs)
│   │   │   ├── decisions/        ← Decision events (+ Telegram channel)
│   │   │   └── upgrade/          ← lode integration (state.json, readiness)
│   │   ├── drizzle/              ← Database migrations
│   │   └── test/                 ← Backend tests (bun:test)
│   └── frontend/                 ← @bkd/frontend
│       └── src/
│           ├── components/       ← UI components (kanban, issue-detail, files, terminal, ui)
│           ├── hooks/            ← React Query + custom hooks
│           ├── pages/            ← Route pages
│           ├── stores/           ← Zustand stores (UI state)
│           ├── lib/              ← API client, utils, event bus
│           ├── i18n/             ← en.json, zh.json
│           └── __tests__/
├── packages/
│   ├── tsconfig/                 ← Shared tsconfig presets
│   └── shared/                   ← @bkd/shared (shared TypeScript types)
├── scripts/
│   ├── package.ts                ← Release packager (bkd-server.tar.gz)
│   ├── migrate-to-lode.ts        ← Move a pre-lode (launcher) install onto lode
│   └── gen-openapi.ts            ← OpenAPI spec generator
├── docs/                         ← Documentation
└── package.json                  ← Monorepo root (Bun Workspaces)
```

## Architecture

### Backend

- **Runtime**: Bun with `Bun.serve()` as the HTTP server
- **Router**: Hono mounted at `/api` via `apps/api/src/app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM
  - Schema: `apps/api/src/db/schema.ts`
  - All tables share `commonFields` (`createdAt`, `updatedAt`, `isDeleted` soft delete)
  - Projects and issues use `shortId()` (nanoid 8-char), logs use `id()` (ULID)
  - Migrations in `apps/api/drizzle/`, auto-applied on startup
- **Logging**: pino (`apps/api/src/logger.ts`)
- **Caching**: In-process LRU+TTL Map-based cache (`cache.ts`, max 500 entries)
- **Static serving**: `APP_DIR/public/` when running from a package, `apps/frontend/dist/` otherwise

#### Middleware

- Security headers: `hono/secure-headers`
- Compression: `hono/compress` (skipped for SSE routes: paths ending in `/stream` or `/api/events`)
- HTTP logging: pino-based request logging
- Global error handler: `{ success: false, error }` envelope
- Validation and REST contract: `@hono/zod-openapi` with shared Zod schemas (OpenAPI at `/api/docs/openapi.json`, Swagger UI at `/api/docs`); multipart handlers validate the same schemas explicitly

#### Data Layer

- Tables: `projects`, `issues`, `issueLogs`, `issuesLogsToolsCall`, `attachments`, `appSettings`, `notes`, `webhooks`, `webhookDeliveries`, `decisionEvents`, `decisionChannelMessages`, `cronJobs`, `cronJobLogs`
- Statuses are hardcoded in `config.ts` (`todo`, `working`, `review`, `done`)
- API responses: `{ success: true, data: T } | { success: false, error: string }`
- Settings (server name, URL, max concurrency, webhooks, etc.) stored in `appSettings` key-value table

#### API Routes

All issue routes are project-scoped under `/api/projects/:projectId/...`:

```
GET/POST       /api/projects
GET/PATCH/DEL  /api/projects/:projectId
GET/POST       /api/projects/:projectId/issues
PATCH          /api/projects/:projectId/issues/bulk
GET/PATCH/DEL  /api/projects/:projectId/issues/:id
POST           /api/projects/:projectId/issues/:id/execute
POST           /api/projects/:projectId/issues/:id/follow-up
POST           /api/projects/:projectId/issues/:id/restart
POST           /api/projects/:projectId/issues/:id/cancel
POST           /api/projects/:projectId/issues/:id/terminate
POST           /api/projects/:projectId/issues/:id/clear-session
GET/DEL        /api/projects/:projectId/issues/:id/pending
GET            /api/projects/:projectId/issues/:id/logs
GET            /api/projects/:projectId/issues/:id/logs/filter/*
GET            /api/projects/:projectId/issues/:id/attachments/:attachmentId
GET            /api/projects/:projectId/issues/:id/changes
GET            /api/projects/:projectId/issues/:id/changes/file
POST           /api/projects/:projectId/issues/:id/duplicate
GET            /api/projects/:projectId/issues/:id/export
GET            /api/projects/:projectId/issues/:id/slash-commands
POST           /api/projects/:projectId/issues/import-session
GET            /api/issues/review
```

Attachments are uploaded through the multipart form of issue create and follow-up; there is no separate upload route.

System routes:

```
GET/POST       /api/engines/*                         ← Engine availability, models
GET            /api/events                            ← SSE event stream
*              /api/decisions/*                       ← Decision events
GET/PATCH      /api/settings/*                        ← App settings, webhooks, upgrade (lode)
*              /api/sessions/*                        ← Local engine sessions
*              /api/terminal/*                        ← Terminal (WebSocket at /api/terminal/ws/:id)
*              /api/files/:root/*                     ← File browser
GET            /api/filesystem/dirs                   ← Directory listing
*              /api/git/detect-remote                 ← Git remote detection
GET/POST       /api/processes/*                       ← Active engine processes
*              /api/projects/:projectId/worktrees/*   ← Git worktree management
*              /api/cron/*                            ← Cron jobs
*              /api/notes/*                           ← Notes
```

#### Engine System

The engine layer is the most complex part of the backend:

- **`types.ts`** — Central types: `EngineType` (`claude-code` | `codex` | `grok` | `cursor`), `EngineExecutor` interface
- **`executors/`** — One per engine (`claude/`, `codex/`, `grok/`, `cursor/`), each implementing `EngineExecutor`
  - Claude Code, Grok, Cursor: `stream-json` protocol (process exits after each turn)
  - Codex: `json-rpc` protocol (subprocess stays alive between turns)
- **`process-manager.ts`** — Process lifecycle, concurrency limits, auto-cleanup
- **`issue/`** — Issue-scoped orchestration (bridge between routes and executors)
- **`reconciler.ts`** — Startup + periodic reconciliation (marks stale sessions as failed)
- **`startup-probe.ts`** — Engine discovery (detects installed CLI agents with 3-tier cache)

#### Background Jobs

Built-in cron actions in `cron/actions/builtins/`, scheduled through the cron system:

- **upload-cleanup** (hourly) — Deletes files in `data/uploads/` older than 7 days
- **worktree-cleanup** (every 30 min, also on startup) — Removes worktrees of `done` issues older than 1 day and of deleted issues; gated by the `worktree:autoCleanup` setting
- **log-cleanup** (daily 03:00) — Trims cron job logs to the last 1000 per job
- **issue-log-retention** (daily 04:00) — Deletes issue logs of `done` issues older than `log:retentionDays` (default 30)
- **decision-event-cleanup** (daily 05:00) — Soft-deletes decision events no longer `open` and unchanged for 1 day

#### Upgrades (lode)

BKD does not update itself. It runs under the [lode](https://github.com/bkhq/lode) supervisor, which fetches `bkd-server.tar.gz` from GitHub Releases, verifies it, installs it under `<dir>/versions/<version>/`, restarts BKD and rolls back on failure. `upgrade/service.ts` only reads lode's `state.json` and writes the request fields the app owns. See `docs/deployment.md`.

### Frontend

- **Framework**: React 19 + Vite 8 + TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Data fetching**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **State**: Zustand for UI-only state (panel open/close, view mode, terminal, file browser, process manager)
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **Path alias**: `@/*` maps to `apps/frontend/src/*`
- **Dev URL routing**: `nsl run` wraps the dev servers; access the app at `http://bkd.localhost` (canonical and only path — Vite no longer has a `/api/*` proxy)
- **Vitest config**: lives in `apps/frontend/vitest.config.ts` (separate from `vite.config.ts`, only loads `tsconfigPaths` + `viteReact` + jsdom env)

#### Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
/review[/:projectId/:issueId]        → ReviewPage (global review queue)
/terminal                            → TerminalPage
/cron                                → CronPage
/decisions                           → DecisionsPage (global decision inbox)
/sessions                            → SessionsPage (local engine sessions)
```

Four global drawers (lazy-mounted when open): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`, `NotesDrawer`.

#### Real-Time Data Flow

```
Server (IssueEngine) → SSE /api/events → EventBus singleton (lib/event-bus.ts)
  → log events → useIssueStream hook → liveLogs state
  → state/done events → React Query cache invalidation
  → issue-updated → projects query invalidation
  → changes-summary → useChangesSummary hook
```

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: @antfu/eslint-config (`eslint.config.js` at root) — no semicolons, single quotes, 2-space indent
  - ESLint enforces `import * as z from 'zod'` (not `import { z } from 'zod'`) via `no-restricted-imports`
  - Import types must use `import type` (separated style) via `@typescript-eslint/consistent-type-imports`
  - Node.js imports must use `node:` prefix
- Frontend tests: vitest + @testing-library/react
- Backend tests: `bun test` with `bun:test`, preload sets `DB_PATH` to temp DB
- Dev env lives in one root `.env` (copy from `.env.example`): `bun run dev` loads it via `bun --env-file=.env`, `dev:api` via `bun --env-file=../../.env`, and Vite reads it through `loadEnv(mode, <repo root>)`. `apps/api/.env` still serves production `start` and drizzle (CWD auto-load)
- IDs: ULID for logs/attachments/tool calls, nanoid 8-char for projects/issues
- Shared types in `packages/shared/src/index.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts`
- All user-facing strings need i18n keys in both `en.json` and `zh.json`
- REST routes must use shared Zod schemas and OpenAPI metadata (`@hono/zod-openapi`); multipart handlers must validate the same schemas explicitly
- All route handlers must verify project existence and cross-project ownership
- Dependency versions managed via Catalogs in root `package.json`
- Component styling: `cn()` utility (`clsx` + `tailwind-merge`) + `class-variance-authority`
- Soft deletion everywhere — `isDeleted` flag, never hard-delete rows

## Environment Variables

### API (`.env` in project root)

| Variable                    | Description                             | Default                         |
| --------------------------- | --------------------------------------- | ------------------------------- |
| `HOST`                      | Listen address                          | `0.0.0.0`                       |
| `PORT`                      | Listen port                             | `3000`                          |
| `ROOT_DIR`                  | Workspace root directory                | auto-detected                   |
| `BKD_DATA_DIR`              | Data directory (`db/`, `logs/`, `uploads/`) | `<ROOT_DIR>/data`           |
| `DB_PATH`                   | SQLite database path, relative to `BKD_DATA_DIR` | `db/bkd.db`            |
| `LOG_LEVEL`                 | Log level                               | `info` (binary) / `debug` (dev) |
| `SERVICE_NAME`              | Logger name prefix                      | `bkd`                           |
| `LOG_EXECUTOR_IO`           | Log executor stdin/stdout               | `1`                             |
| `ANTHROPIC_API_KEY`         | Claude API key                          | —                               |
| `OPENAI_API_KEY`            | OpenAI / Codex API key                  | —                               |
| `CODEX_API_KEY`             | Codex-specific API key (fallback)       | —                               |
| `ENABLE_RUNTIME_ENDPOINT`   | Enable `/api/runtime` debug endpoint    | disabled                        |

Server name, server URL, webhooks, max concurrent sessions, and other runtime settings are managed in the Settings UI and persisted in the `appSettings` database table. Environment variables `SERVER_NAME` and `SERVER_URL` are used as initial seed values only.

### Frontend (root `.env`)

`vite.config.ts` reads these via `loadEnv(mode, <repo root>)` (Vite-standard `.env` resolution in the repository root: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`, then matching `process.env` entries). Under `bun run dev`, nsl passes Vite its own `--port`, so `VITE_DEV_PORT` only applies when Vite runs without nsl.

| Variable        | Description     | Default   |
| --------------- | --------------- | --------- |
| `VITE_DEV_PORT` | Dev server port | `3000`    |
| `VITE_DEV_HOST` | Dev server host | `0.0.0.0` |

> Dev routing goes through nsl at `http://bkd.localhost`. Vite has no `/api/*` proxy — access the app via `bkd.localhost`. nsl is dev-only — production builds serve everything from a single Bun process.

## Adding a New API Endpoint (end-to-end)

1. Define shared types in `packages/shared/src/index.ts`
2. Add route + Zod schema in `apps/api/src/routes/` (verify project ownership for scoped routes)
3. Add API client function in `apps/frontend/src/lib/kanban-api.ts`
4. Add React Query hook in `apps/frontend/src/hooks/use-kanban.ts` (add query key to `queryKeys` factory)
5. Wire into component
6. Add i18n keys in both `en.json` and `zh.json`

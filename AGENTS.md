# Project Guide

Repository conventions and verified development commands.

## Project Overview

Kanban app with a Bun/Hono API backend and a React/Vite frontend, structured as a **Bun Workspaces monorepo**.

Workspaces:

- `apps/api` (`@bkd/api`) — Backend API server
- `apps/frontend` (`@bkd/frontend`) — React frontend
- `packages/shared` (`@bkd/shared`) — Shared TypeScript types

## Commands

```bash
# Dev (starts both API + Vite in parallel via Bun --filter; both wrapped in nsl)
# Access via http://bkd.localhost — nsl proxy routes /api/* → API, rest → Vite.
# This is the only dev entry point: Vite no longer has a /api/* proxy.
bun run dev                  # API + Vite in parallel
bun run dev:api              # API server only (port 3010, registered at bkd.localhost/api)
bun run dev:frontend         # Vite dev server only (port 3000, registered at bkd.localhost)

# All workspaces
bun install                  # single install for all workspaces
bun run test                 # run tests in all workspaces (parallel)
bun run lint                 # lint all workspaces
bun run typecheck            # typecheck API and frontend
bun run check                # lint, typecheck, tests, and frontend build

# Backend (@bkd/api)
bun run test:api             # backend tests only
bun --filter @bkd/api lint  # backend lint

# Frontend (@bkd/frontend)
bun run test:frontend        # frontend tests only
bun run build                # vite build -> apps/frontend/dist/
bun --filter @bkd/frontend lint  # frontend lint

# Database
bun run db:generate          # drizzle-kit generate (creates migration SQL)
bun run db:migrate           # drizzle-kit migrate (applies migrations)
bun run db:reset             # deletes SQLite DB files (data/db/bkd.db)
```

## Architecture

### Monorepo Structure

```
bkd/
├── apps/
│   ├── api/                      ← @bkd/api
│   │   ├── src/
│   │   │   ├── index.ts          ← CLI entry; loads server-main.ts for HTTP serving
│   │   │   ├── app.ts            ← Hono router + middleware
│   │   │   ├── config.ts         ← Hardcoded statuses (todo/working/review/done)
│   │   │   ├── db/               ← SQLite/Drizzle schema + migrations
│   │   │   ├── engines/          ← AI engine executors + process management
│   │   │   ├── routes/           ← API routes
│   │   │   ├── events/           ← SSE event system
│   │   │   └── cron/             ← Persistent scheduled jobs and cleanup actions
│   │   ├── drizzle/              ← Database migrations (auto-applied on startup)
│   │   ├── drizzle.config.ts     ← Drizzle-kit configuration
│   │   └── test/                 ← Backend tests (bun:test)
│   └── frontend/                 ← @bkd/frontend
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx          ← App entry
│           ├── components/       ← UI components (kanban, issue-detail, ui)
│           ├── hooks/            ← React Query + custom hooks (use-kanban.ts)
│           ├── pages/            ← Route pages
│           ├── stores/           ← Zustand (board, panel, view-mode)
│           ├── lib/              ← API client, utils, constants
│           ├── i18n/             ← en.json, zh.json
│           ├── types/            ← Re-exports from @bkd/shared
│           └── __tests__/
├── packages/
│   ├── tsconfig/                 ← Shared tsconfig (base, hono, react, utils)
│   │   ├── package.json
│   │   ├── base.json
│   │   ├── hono.json
│   │   ├── react.json
│   │   └── utils.json
│   └── shared/                   ← @bkd/shared (shared types)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts          ← TypeScript types (Project, Issue, etc.)
├── scripts/package.ts           ← Bundles the server, docs assets, frontend, and migrations
├── data/                         ← SQLite database (gitignored)
├── package.json                  ← Monorepo root + Catalogs
└── bun.lock                     ← Single lock file
```

### Backend (`apps/api/src/`)

- **Runtime**: Bun with `Bun.serve()` as the HTTP server
- **Router**: Hono — mounted at `/api` via `apps/api/src/app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (`apps/api/src/db/`)
  - Schema defined in `apps/api/src/db/schema.ts` using Drizzle's `sqliteTable`
  - Most entities share `commonFields` (`createdAt`, `updatedAt`, `isDeleted`). Projects, issues, and cron jobs use random eight-character IDs; logs and attachments use ULIDs.
  - Migrations live in `drizzle/` and run automatically on startup
  - Config: `drizzle.config.ts`
- **Logging**: pino (`apps/api/src/logger.ts`)
- **Static serving**: In production, `apps/api/src/server-main.ts` serves `apps/frontend/dist/` with SPA fallback

#### Security & Middleware (`apps/api/src/app.ts`)

- **Auth**: Handled by external reverse proxy (no built-in auth middleware)
- **Security headers**: `hono/secure-headers` (X-Frame-Options, X-Content-Type-Options, etc.)
- **Global error handler**: `app.onError()` returns `{success: false, error}` envelope; logs via pino
- **Input validation**: JSON REST routes use `createRoute` + `app.openapi()` with Zod schemas. Multipart and wildcard handlers register explicit contracts and validate their parsed fields.

#### Data Layer

- `apps/api/src/db/index.ts` + `apps/api/src/db/schema.ts` — SQLite/Drizzle ORM. Tables include `projects`, `issues`, `issueLogs`, `issuesLogsToolsCall`, `attachments`, `appSettings`, `notes`, `cronJobs`, `cronJobLogs`, `webhooks`, and `webhookDeliveries`. All route handlers use Drizzle queries directly.
- `apps/api/src/config.ts` — Hardcoded status constants (`STATUSES`, `STATUS_MAP`, `STATUS_IDS`, `DEFAULT_STATUS_ID`). Statuses are fixed (todo, working, review, done) — no DB table.
- Migrations in `drizzle/`, auto-applied on startup.

#### API Routes

Project resources are scoped under `/api/projects/:projectId/...`. Settings, engines, cron, notes, filesystem, terminal, and process routes are application-wide:

```
GET/POST       /api/projects
GET/PATCH      /api/projects/:projectId
GET/POST       /api/projects/:projectId/issues
PATCH          /api/projects/:projectId/issues/bulk
GET/PATCH      /api/projects/:projectId/issues/:id
POST           /api/projects/:projectId/issues/:id/execute
POST           /api/projects/:projectId/issues/:id/follow-up
POST           /api/projects/:projectId/issues/:id/restart
POST           /api/projects/:projectId/issues/:id/cancel
GET            /api/projects/:projectId/issues/:id/logs
```

JSON CRUD responses use the envelope `{ success: true, data: T } | { success: false, error: string }`. Project-scoped routes validate project existence and resource ownership. File downloads, conversation exports, SSE, and WebSockets have dedicated transport formats.

### Frontend (`apps/frontend/`)

- **Framework**: React 19 + Vite 8 + TypeScript
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin
- **Routing**: react-router-dom v7
- **Data fetching**: TanStack React Query v5
- **Drag & drop**: @atlaskit/pragmatic-drag-and-drop for kanban board
- **Dialogs**: shadcn/ui primitives backed by `@base-ui/react`
- **Icons**: lucide-react
- **i18n**: i18next + react-i18next, Chinese (zh, default) and English (en). Translations in `apps/frontend/src/i18n/{en,zh}.json`. Language persisted to localStorage (`i18n-lang`).
- **Path alias**: `@/*` maps to `apps/frontend/src/*`
- **Dev URL routing**: dev scripts wrap servers in `nsl run`, so `http://bkd.localhost/api/*` reaches the API and the rest reaches Vite. This is the only dev entry — Vite no longer has a `/api/*` proxy.

#### State Management

Two state systems, each with a distinct role:

- **TanStack React Query** — Server state (projects, issues). All hooks in `apps/frontend/src/hooks/use-kanban.ts`. Query keys use a `queryKeys` factory with hierarchical keys (e.g. `['projects', projectId, 'issues']`). All hooks have `enabled` guards. `useBulkUpdateIssues` uses optimistic updates. QueryClient defaults: `staleTime: 30s`, `retry: 1`. Statuses are hardcoded constants in `apps/frontend/src/lib/statuses.ts` — not fetched from server.
- **Zustand stores** — Local UI state only:
  - `board-store.ts` — Drag-and-drop state (`groupedItems`, `isDragging`). Syncs from server data but pauses sync while dragging. Uses explicit `resetDragging()` tied to mutation `onSettled`.
  - `panel-store.ts` — Side panel and create dialog open/close state.
  - `view-mode-store.ts` — Kanban/list view toggle, persisted to localStorage (`kanban-view-mode`).

#### Component Areas

- `components/ui/` — shadcn/ui primitives (Button, Dialog, Badge, etc.)
- `components/kanban/` — Kanban board: columns, cards, sidebar, create issue dialog
- `components/issue-detail/` — Issue detail page: chat area, diff panel, issue list, review dialog

#### Component Styling

Components use the shadcn/ui pattern: `cn()` utility (`apps/frontend/src/lib/utils.ts`) combining `clsx` + `tailwind-merge`, with `class-variance-authority` for component variants.

#### Theme

`useTheme()` hook (`apps/frontend/src/hooks/use-theme.ts`) — supports `light`, `dark`, `system` modes, persisted to localStorage (`kanban-theme`).

#### Error Handling

- `ErrorBoundary` component wraps all routes in `main.tsx` — catches render errors with reload button
- `Suspense` with spinner fallback wraps lazy-loaded route components

#### Shared Utilities

- `apps/frontend/src/hooks/use-click-outside.ts` — Shared click-outside hook (used by 5+ components)
- `apps/frontend/src/lib/format.ts` — `formatSize()`, `getProjectInitials()`
- `apps/frontend/src/lib/constants.ts` — `LANGUAGES` constant

#### Frontend Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
```

### Shared Types (`packages/shared/`)

`@bkd/shared` contains TypeScript types used by both backend and frontend. The frontend's `types/kanban.ts` re-exports from `@bkd/shared` for backwards compatibility.

### Dev Workflow

- `bun run dev` starts both API (port 3010) and Vite (port 3000) via `bun --filter`. Each server is wrapped in `nsl run`, registering routes at `http://bkd.localhost/api` and `http://bkd.localhost/`. The nsl proxy daemon must be running (`bunx nsl start` once); the npm package `@dotns/nsl` is installed at the repo root, so `bun install` is the only setup step.
- `http://bkd.localhost` is the only dev entry — Vite has no `/api/*` proxy.
- `bun run dev:api` / `bun run dev:frontend` can be run individually in separate terminals if needed
- Production: `bun run build` then `bun run start` — the Bun server handles both API and static file serving on port 3000

## API and Runtime Baseline

- SQLite transaction callbacks are synchronous. Use `.all()`, `.get()`, and `.run()` within transactions; perform asynchronous filesystem and process work outside them.
- Issue lists default to 100 rows (maximum 200). Follow `nextCursor` while `hasMore` is true; the frontend aggregates pages for a complete board.
- Cron cursors encode `(createdAt, id)` and must use the same descending order in filtering and sorting.
- `/api/docs` serves local Swagger assets under the application CSP; `/api/docs/openapi.json` is the live contract. Documentation deliberately retains Swagger rather than changing renderers.
- `runtime-config.ts` validates HTTP, logging, execution-capacity, worktree, and CORS settings at startup. External engine credentials remain in the engine environment layer.
- Responses expose `X-Request-ID`; structured HTTP logs include request ID, status, and elapsed time without request bodies or credentials.
- CI runs on main pushes, pull requests, and releases. Bun 1.4.0 is pinned to the runtime validated for this change; dependency installs use the frozen lockfile.
- TypeScript 6 and React Router are retained for the existing application; framework migration is outside this remediation.

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: @antfu/eslint-config (`eslint.config.js` at root) — no semicolons, single quotes
- Frontend tests use vitest + @testing-library/react (`bun run test:frontend`, noninteractive; `bun --filter @bkd/frontend test:watch` for watch mode)
- Backend tests use `bun test` with `bun:test` (`bun run test:api`)
- Bun auto-loads `.env` — do not use dotenv
- Projects, issues, and cron jobs use random short IDs; logs and attachments use ULIDs. Random IDs are not chronological cursors.
- Shared types live in `packages/shared/src/index.ts` — frontend re-exports via `apps/frontend/src/types/kanban.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts` — add new endpoints here, then wrap in React Query hooks in `use-kanban.ts`
- All user-facing strings must have i18n keys in both `en.json` and `zh.json`
- Declare JSON REST routes with `createRoute` + `app.openapi()`. Reuse the same Zod schemas for manually parsed multipart fields. Never rely on `c.req.json<T>()` for runtime validation.
- All route handlers must verify project existence and cross-project ownership before operating on scoped entities
- Dependency versions shared across workspaces are managed via Catalogs in root `package.json`

## Project Development

This repository follows the PMA workflow. The actual rules live in the `/pma`
skill and the stack skills below — do not duplicate them here. If a rule in
this file ever conflicts with `/pma`, treat `/pma` as the source of truth and
update this file.

### Skill stack

- `/pma` — workflow control, three-phase gate, task and plan tracking
- `/pma-bun` — implementation baseline for the Bun/Hono API (`apps/api`)
- `/pma-web` — implementation baseline for the React/Vite frontend (`apps/frontend`)
- `/pma-cr` — code review on the local diff before commit or PR

### Triggers

Any feature, bug fix, refactor, planning, progress tracking, or multi-agent
execution goes through `/pma` (investigate → proposal → implement). Ceremony is
tiered by complexity per `/pma` *Task Tiers*: only trivial changes take the fast
path; everything else waits for explicit approval such as `proceed`.

### Project-specific facts

- Primary language / runtime: TypeScript on Bun 1.4
- Database / storage: SQLite via `bun:sqlite` + Drizzle ORM (`apps/api/drizzle/`)
- Dev URL routing: nsl on, host `bkd.localhost` (`/api/*` → API, rest → Vite)
- Deployment target: `bkd-server.tar.gz` release artifact supervised by lode
- Quality-gate command: `bun run check`
- Fast path: enabled (default)

### Local divergences

Any deliberate deviation from a skill rule (Hard Lock relaxation, alternative
library, non-default layout) is recorded in `docs/decisions/<YYYY-MM-DD>-<slug>.md`
with a sunset date. Do not silently override skill rules in this file.

### Documentation entry points

- Tasks: `docs/task/index.md`
- Plans: `docs/plan/index.md`
- Decisions: `docs/decisions/`
- Architecture: `docs/architecture.md`
- Changelog: `docs/changelog.md`

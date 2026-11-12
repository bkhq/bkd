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
bun run dev:api              # API server only (registered at bkd.localhost/api; nsl assigns the port)
bun run dev:frontend         # Vite dev server only (registered at bkd.localhost; nsl assigns the port)

# All workspaces
bun install                  # single install for all workspaces
bun run test                 # run tests in all workspaces (parallel)
bun run lint                 # lint all workspaces
bun run typecheck            # tsc --noEmit in API and frontend (TS 7)
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

The architecture is documented once, in these places; this file does not repeat it:

- `CLAUDE.md` — subsystem notes for the backend (engines, messages, skills, file manager, cron, upgrade) and the
  frontend (routes, state, real-time flow), kept current with each change
- `docs/architecture.md` — tables, routes, engine layout, stores, build and distribution
- `docs/api/` — REST reference; the live contract is `/api/docs/openapi.json`
- `docs/development.md` — setup, scripts, environment variables
- `docs/deployment.md` — the release artifact and running under lode

Monorepo layout: `apps/api` (`@bkd/api`, Bun/Hono), `apps/frontend` (`@bkd/frontend`, React/Vite),
`packages/shared` (`@bkd/shared`, types and status constants), `packages/tsconfig`. Dev runs through nsl at
`http://bkd.localhost`; production is the `bkd-server.tar.gz` artifact supervised by lode.

## API and Runtime Baseline

- SQLite transaction callbacks are synchronous. Use `.all()`, `.get()`, and `.run()` within transactions; perform asynchronous filesystem and process work outside them.
- Issue lists default to 100 rows (maximum 200). Follow `nextCursor` while `hasMore` is true; the frontend aggregates pages for a complete board.
- Cron cursors encode `(createdAt, id)` and must use the same descending order in filtering and sorting.
- `/api/docs` serves local Swagger assets under the application CSP; `/api/docs/openapi.json` is the live contract. Documentation deliberately retains Swagger rather than changing renderers.
- `runtime-config.ts` validates HTTP, logging, execution-capacity, worktree, and CORS settings at startup. External engine credentials remain in the engine environment layer.
- Responses expose `X-Request-ID`; structured HTTP logs include request ID, status, and elapsed time without request bodies or credentials.
- CI runs on main pushes, pull requests, and releases. Bun 1.4.2 is pinned to the runtime validated for this change; dependency installs use the frozen lockfile.
- Workspaces typecheck with TypeScript 7; the repository root keeps TypeScript 6 for typescript-eslint (see `CLAUDE.md`). React Router is retained for the existing application; framework migration is outside this remediation.

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: @antfu/eslint-config (`eslint.config.js` at root) — no semicolons, single quotes
- Frontend tests use vitest + @testing-library/react (`bun run test:frontend`, noninteractive; `bun --filter @bkd/frontend test:watch` for watch mode)
- Backend tests use `bun test` with `bun:test` (`bun run test:api`)
- Dev env lives in the root `.env` (loaded with `bun --env-file`); do not use dotenv
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

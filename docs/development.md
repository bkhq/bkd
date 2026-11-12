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
│   │   │   ├── index.ts          ← CLI entry (`fix-db`); loads server-main.ts to serve
│   │   │   ├── server-main.ts    ← Bun.serve, static serving, startup and shutdown
│   │   │   ├── app.ts            ← Hono router + middleware
│   │   │   ├── db/               ← SQLite/Drizzle schema, migrations runner, repair
│   │   │   ├── engines/          ← AI engine executors + process management
│   │   │   ├── routes/           ← API routes
│   │   │   ├── openapi/          ← Shared Zod schemas and route contracts
│   │   │   ├── events/           ← Event bus, SSE, changes summary
│   │   │   ├── cron/             ← Cron scheduler + actions (built-in cleanup jobs)
│   │   │   ├── messages/         ← Decisions and notifications (+ Telegram channel)
│   │   │   ├── webhooks/         ← Webhook, Telegram and browser notification delivery
│   │   │   ├── skills/           ← Agent skills on disk, `skills` CLI operations
│   │   │   ├── sessions/         ← Local engine session readers
│   │   │   ├── fm/               ← Vendored bkhq/filemanager (router, local driver)
│   │   │   └── upgrade/          ← lode integration (state.json, readiness)
│   │   ├── drizzle/              ← Database migrations
│   │   └── test/                 ← Backend tests (bun:test)
│   └── frontend/                 ← @bkd/frontend
│       └── src/
│           ├── components/       ← UI components (kanban, issue-detail, files, messages, skills, terminal, ui)
│           ├── fm/               ← Vendored bkhq/filemanager UI
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

The backend, the engine system, the frontend and the data flow are described in
[architecture.md](./architecture.md); the REST routes are in [api/](./api/README.md), and the live contract is served
at `/api/docs`. Deployment under lode is in [deployment.md](./deployment.md).

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
- Component styling: `cn()` from the `cn` package (`clsx` + `tailwind-merge`) + `class-variance-authority`
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
| `LOG_LEVEL`                 | Log level                               | `info`                          |
| `SERVICE_NAME`              | Logger name prefix                      | `bkd`                           |
| `LOG_EXECUTOR_IO`           | Log executor stdin/stdout               | `1`                             |
| `ALLOWED_ORIGIN`            | CORS origins: `*` or comma-separated HTTP origins | `*`                   |
| `MAX_CONCURRENT_EXECUTIONS` | Initial cap on parallel AI sessions     | `5`                             |
| `WORKTREE_DIR`              | Issue worktree directory, relative to `ROOT_DIR` unless absolute | `worktrees` |
| `BKD_FM_DATA_DIR`           | File manager trash and upload staging   | `<data dir>/fm`                 |
| `GITHUB_TOKEN` / `GH_TOKEN` | Token for the skills update check against GitHub | —                      |
| `ANTHROPIC_API_KEY`         | Claude API key                          | —                               |
| `OPENAI_API_KEY`            | OpenAI / Codex API key                  | —                               |
| `CODEX_API_KEY`             | Codex-specific API key (fallback)       | —                               |
| `ENABLE_RUNTIME_ENDPOINT`   | Enable `/api/runtime` debug endpoint    | disabled                        |

`runtime-config.ts` validates `HOST`, `PORT`, `LOG_LEVEL`, `SERVICE_NAME`, `MAX_CONCURRENT_EXECUTIONS`, `WORKTREE_DIR` and `ALLOWED_ORIGIN` at startup; an invalid value stops the server.

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

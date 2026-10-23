# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kanban app for managing AI coding agents. Issues on the board are assigned to CLI-based AI engines (Claude Code, Codex) that execute autonomously in the user's workspace.

Structured as a **Bun Workspaces monorepo**:

- `apps/api` (`@bkd/api`) — Bun/Hono backend server
- `apps/frontend` (`@bkd/frontend`) — React/Vite frontend
- `packages/shared` (`@bkd/shared`) — Shared TypeScript types
- `packages/tsconfig` (`@bkd/tsconfig`) — Shared TS configs (base, hono, react, utils)

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
bun run typecheck            # tsc --noEmit in every workspace (TS 7)

# Backend (@bkd/api)
bun run test:api             # backend tests only
bun --filter @bkd/api lint  # backend lint

# Frontend (@bkd/frontend)
bun run test:frontend        # frontend tests only
bun run build                # vite build -> apps/frontend/dist/
bun --filter @bkd/frontend lint  # frontend lint

# Run a single test file
cd apps/api && bun test --preload ./test/preload.ts test/api-issues.test.ts
cd apps/frontend && bunx vitest run src/__tests__/lib/format.test.ts

# Database (drizzle config lives in apps/api/)
bun run db:generate          # drizzle-kit generate (proxies to @bkd/api)
bun run db:migrate           # drizzle-kit migrate (proxies to @bkd/api)
bun run db:reset             # deletes SQLite DB files (data/db/bkd.db)

# Create the release artifact (tar.gz with server.js + assets + migrations, ~2 MB).
# This is the only distributable: lode installs and runs it. See docs/deployment.md.
bun run package              # builds frontend + bundles server + creates tar.gz
bun scripts/package.ts --version 0.0.7 --outfile bkd-server.tar.gz --skip-frontend

# Migrate a pre-lode (launcher) install onto lode — dry run by default
bun scripts/migrate-to-lode.ts --root /opt/bkd
bun scripts/migrate-to-lode.ts --root /opt/bkd --apply --prune
```

## Architecture

### Backend (`apps/api/src/`)

- **Runtime**: Bun with `Bun.serve()` (WebSocket support, `idleTimeout: 60`)
- **Router**: Hono — mounted at `/api` via `app.ts`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM (WAL mode, 64 MB cache, 256 MB mmap)
  - Schema in `db/schema.ts`. All tables share `commonFields` (`createdAt`, `updatedAt`, `isDeleted` soft delete)
  - Projects/issues use `shortId()` (nanoid 8-char), logs use `id()` (ULID)
  - Migrations in `apps/api/drizzle/`, auto-applied on startup. Runtime applies them in `meta/_journal.json` order, tracked per-DB in `__drizzle_migrations` (snapshots are never read at runtime). Rules: never edit or reorder a shipped migration (drizzle keys applied state by file hash); only append new ones via `bun run db:generate`; always commit the schema change, generated `.sql`, `meta/<n>_snapshot.json`, and `_journal.json` together. CI (`Migrations` job) fails if `db:generate` yields uncommitted changes. Intermediate snapshots `0001,0005,0012,0014–0019` are missing — accepted (archival-only; the diff base re-aligned at `0020`, see ENG-009)
- **Logging**: pino (`logger.ts`)
- **Caching**: in-process LRU+TTL Map-based cache (`cache.ts`, max 500 entries)
- **Static serving**: `APP_DIR/public/` when running from a package, `apps/frontend/dist/` in dev

#### Middleware (`app.ts`)

- `secureHeaders()` — security response headers
- `compress()` — gzip/deflate (skipped for SSE routes: paths ending in `/stream` or `/api/events`)
- `httpLogger()` — pino-based request logging
- `@hono/zod-openapi` — Shared Zod request validation and REST contracts; multipart handlers explicitly validate the same schemas
- Global error handler: returns `{success: false, error}` envelope

#### Data Layer

Tables: `projects`, `issues`, `issueLogs`, `issuesLogsToolsCall`, `attachments`, `appSettings` (key-value store for server settings), `notes`, `messages`, `messageChannelMessages`, `webhooks`, `webhookDeliveries`, `cronJobs`, `cronJobLogs`.

Message search: `issues_logs_fts` (FTS5, `trigram` tokenizer, migration `0028`) indexes visible `user-message`/`assistant-message` rows, kept in sync by triggers on `issues_logs` and keyed by its implicit `rowid`. `VACUUM` may renumber those rowids, so every `VACUUM` must be followed by `rebuildIssueLogsFts()` (`db/issue-log-search.ts`). Queries under 3 characters fall back to `LIKE`.

Statuses are hardcoded constants in `config.ts` (`todo`, `working`, `review`, `done`) — no DB table.

Issue create resolves engine/model by precedence: explicit request value → per-project default (`projects.defaultEngine`/`defaultModel`) → global default (`appSettings`) → `claude-code` fallback. An engine with no registered executor is coerced to `claude-code`.

API response envelope: `{ success: true, data: T } | { success: false, error: string }`

#### API Routes

All issue routes are project-scoped under `/api/projects/:projectId/...`:

```
GET/POST       /api/projects
GET/PATCH/DEL  /api/projects/:projectId
GET/POST       /api/projects/:projectId/issues
PATCH          /api/projects/:projectId/issues/bulk
GET            /api/projects/:projectId/issues/search
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
Multipart bodies (attachments and `/api/files/:root/upload`) are streamed to disk by `parseMultipartUpload()` in `uploads.ts` (`@fastify/busboy`, 1 GB total per request) — never use `c.req.formData()` for uploads, it buffers the whole body in memory.

The `/logs/filter/*` route accepts path-based key/value filter pairs (order-independent):
- `types/<comma-separated>` — filter by entry type (`user-message`, `assistant-message`, `tool-use`, `system-message`, `thinking`)
- `turn/<value>` — filter by turn: single (`3`), range (`2-5`), `last`, or `lastN` (`last3`)
- Example: `/logs/filter/types/user-message,assistant-message/turn/last3`
- Pagination via query params: `cursor`, `before`, `limit`

System routes: `/api/engines/*`, `/api/events` (SSE), `/api/messages/*`, `/api/decisions/*` (v1), `/api/settings/*` (incl. `/api/settings/upgrade/*`), `/api/sessions/*`, `/api/terminal/*` (incl. `/api/terminal/ws/:id`), `/api/files/:root/*`, `/api/filesystem/dirs`, `/api/git/detect-remote`, `/api/processes/*`, `/api/projects/:projectId/worktrees/*`, `/api/cron/*`, `/api/notes/*`, `/api/skills/*`.

Issue routes are split across focused files in `routes/issues/`: `query.ts`, `create.ts`, `update.ts`, `delete.ts`, `command.ts`, `message.ts`, `logs.ts`, `attachments.ts`, `changes.ts`, `duplicate.ts`, `export.ts`, `import-session.ts`, `review.ts`, `search.ts`. Shared schemas and helpers in `_shared.ts`.

#### Engine System (`engines/`)

The most complex subsystem — bridges API routes and CLI-based AI agents.

**Engine types and protocols:**

- `claude-code` — `stream-json` protocol (streaming JSON over stdout, process exits after each turn).
  Requires a CLI new enough to accept `--forward-subagent-text` (verified on 2.1.231); BKD passes it
  unconditionally so subagent turns reach the chat, and an older CLI fails to start rather than
  silently hiding subagent activity (ENG-032)
- `codex` — `json-rpc` protocol (JSONL JSON-RPC over stdio, process **stays alive** between turns)
- `grok` — Grok Build CLI, `stream-json` protocol (`grok -p --output-format streaming-messages-json`, one prompt per
  process, exits after the turn). Follow-up resumes with `-r <sessionId>`; cancel is SIGTERM so the CLI saves the
  session. Headless mode has no stdin channel, so every permission policy runs with `bypassPermissions` and
  pending messages wait for the next turn. Its normalizer is self-contained — do not import from `executors/claude/`
- `cursor` — Cursor CLI (`cursor-agent`), `stream-json` protocol (`cursor-agent -p --output-format stream-json --force
  --trust --workspace <dir>`, one prompt per process, exits after the turn). `--resume <id>` creates the session when
  the id is unknown and resumes it otherwise, so the first turn passes BKD's pre-generated id. Cancel is SIGTERM. Only
  the legacy `cursor-agent` name is resolved: the `agent` name collides with grok's alias. Its normalizer is
  self-contained

Each engine has an executor in `executors/<name>/executor.ts` implementing `EngineExecutor` interface: `spawn`, `spawnFollowUp`, `cancel`, `getAvailability`, `getModels`, `normalizeLog`.

**Key subsystems:**

- **`process-manager.ts`** — Generic `ProcessManager<TMeta>` for any Bun.spawn subprocess. State machine: `spawning → running → completed/failed/cancelled`. Groups processes by issue ID. Auto-cleanup after 5 min, GC every 10 min.
- **`issue/engine.ts`** — `IssueEngine` singleton facade. Per-issue serial lock prevents concurrent operations. Manages entry counters, turn indexes, log/state callbacks. Public API: `executeIssue`, `followUpIssue`, `restartIssue`, `cancelIssue`, etc.
- **`issue/orchestration/`** — `execute.ts`, `follow-up.ts`, `restart.ts`, `cancel.ts`
- **`issue/lifecycle/`** — Spawn with session fallback, completion monitoring (auto-retry on failure, pending message coalescence), settlement
  - Settlement waits on background tasks: while the CLI's `background_tasks_changed` set is non-empty, a `result` does not settle the issue, because the CLI runs another turn once a task reports back. The hold is capped at 10 min, and a turn that reopens on a live process reverts the automatic move to `review` (ENG-036)
- **`issue/streams/`** — Stdout consumption via async generator, log classification, stderr drain
- **`reconciler.ts`** — Safety net: marks stale `running`/`pending` sessions as `failed` on startup; moves orphaned `working` issues to `review`. Runs on startup + every 60s + 1s after each issue settlement.
- **`startup-probe.ts`** — Engine discovery with 3-tier cache: memory (10 min) → DB (`appSettings`, no expiry) → live probe (15s per-engine timeout, all engines probed in parallel). A probe spawns the engine CLIs — for Claude that includes `claude auth status`, which touches the rotating OAuth credential — so it runs only on demand: first install, a vanished binary, or the settings "probe engines" button (ENG-035). `claude-code`'s catalog is static in code and always overlaid on cached data

**Execution flow:**

```
Route handler → IssueEngine.executeIssue() → acquires per-issue lock
  → updates DB (sessionStatus='running') → executor.spawn() → ProcessManager.register()
  → consumeStream() (async generator over stdout) → persistence/ (DB writes) + events/ (SSE emit)
  → monitorCompletion() watches subprocess.exited → settleIssue() (status → 'review')
```

**Follow-up flow** (Codex is special — process stays alive):

- Claude: spawns new process with `--resume <sessionId>` flag
- Codex: sends `turn/start` to existing process via JSON-RPC; if process died, spawns new `app-server` with `thread/resume`. `thread/resume` must re-send the thread params (`cwd`, `sandbox`, `approvalPolicy`, `model`) — the app-server does not restore them and silently falls back to `~/.codex/config.toml` defaults

#### Real-Time Events (`events/`)

Global SSE endpoint (`GET /api/events`) via Hono `streamSSE`:

- Event types: `log`, `state`, `done`, `issue-updated`, `changes-summary`, `message-updated`, `heartbeat` (15s)
- Subscribes to `IssueEngine` callbacks + `onIssueUpdated` + `onChangesSummary`
- `changes-summary.ts`: runs `git status/diff` after each issue settles, pushes stats via SSE

#### Cron System (`cron/`)

Scheduled task execution with cron expressions (powered by `baker` scheduler). DB tables: `cronJobs`, `cronJobLogs`. Supports pluggable actions (`actions/` directory) — each action type (e.g., execute issue, HTTP request) implements a standard interface. Features: auto-pause after 3 consecutive failures, execution logs with pagination, soft-delete.

Routes: `GET/POST /api/cron`, `DELETE /api/cron/:jobId`, `POST /api/cron/:jobId/{trigger,pause,resume}`, `GET /api/cron/:jobId/logs`, `GET /api/cron/actions`.

#### Messages (`messages/`)

Agent-authored messages to the user, in one `messages` table with a `kind`: `decision` (one question with options, the `bkd` skill's decision contract) and `notification` (a headline + Markdown body with a `level` of `info/success/warning/error`). BKD is the platform only — it never creates a message. `expects` is `reply` for every decision and optional for a notification; a notification with `expects: none` is one-way.

- States: decision `open → decided → applied`; reply-notification `open → replied → applied`; both `open → withdrawn` and `open | answered → closed`; plain notification `unread → read`. Wrong-kind or wrong-state actions return 409.
- Answering (decide / reply) wakes the `source` issue via `dispatchFollowUp()` (`routes/issues/_shared.ts`, shared with the follow-up route) with a signal only: `[event-decision eventId=… campaignId=…]` for decisions (kept for v1 agents), `[message-reply messageId=…[ campaignId=…]]` for notifications. The issue re-reads the message, then `ack`s. A failed wake leaves it answered; `POST …/notify` resends.
- Closing is the user's way to end a message without answering; it sends no follow-up.
- Notifications are rate-limited to 30 a minute per source issue (429), in memory.
- Every write emits `message-updated` (bus + SSE).
- `webhooks/dispatcher.ts` announces each state once per channel: decisions as `decision.{opened,decided,applied,withdrawn,closed}` with the v1 payload, notifications as `message.{sent,replied,applied,withdrawn,closed}` with a `{ message, source, ref, links, server }` envelope (`read` is not announced). There is no per-message channel targeting; receivers route on the metadata. Interactive Telegram channels are skipped for messages awaiting a reply.
- Webhook URLs may target loopback and private networks; `utils/url-safety.ts` still blocks link-local (cloud metadata) and reserved ranges, at save time and at delivery.
- `messages/telegram/`: a Telegram channel with `webhooks.interactive` posts every open message awaiting a reply (decisions with option buttons, notifications with a close button) and long-polls `getUpdates` for presses and replies (no inbound route). Answers go through `decideMessage()` / `replyMessage()` in `messages/service.ts`, shared with the REST routes; `messageChannelMessages` maps message → chat message. One poller per bot token — the bot must not be consumed elsewhere.
- `/api/decisions/*` is the v1 contract kept for existing agents: the same store restricted to `kind = 'decision'`, v1 field names (`question/context/notify`), `contractVersion: 1`. It forwards in-process — never an HTTP redirect, agents call it with plain `curl`.

Routes: `GET /api/messages` (capability probe, `{ supported, contractVersion: 2, kinds }`), `GET/POST /api/messages/items`, `POST /api/messages/items/read`, `GET/PATCH /api/messages/items/:id`, `POST /api/messages/items/:id/{decision,reply,notify,ack,withdraw,close,read}`; v1: `GET /api/decisions`, `GET/POST /api/decisions/events`, `GET/PATCH /api/decisions/events/:id`, `POST /api/decisions/events/:id/{decision,notify,ack,withdraw,close}`.

#### Skills (`skills/`)

Agent skills are read and written on disk in the layout of the `skills` CLI (vercel-labs/skills); BKD never calls an engine CLI for them. Roots come from `HOME` at call time (plus a project's directory): the shared store `.agents/skills/<name>/` (read by Codex; entries tracked in `.agents/.skill-lock.json` are *managed*; a lock that exists but cannot be parsed makes every store skill read-only) and `.claude/skills/` (read by Claude Code: symlinks into the store plus real skill dirs). Global paths resolve as `skills@1.7.4` does: the lock is `$XDG_STATE_HOME/skills/.skill-lock.json` when that is set, and the Claude dir is `$CLAUDE_CONFIG_DIR/skills` when that is set. A skill is a directory with `SKILL.md`; name and description come from its frontmatter. Identity is `location` (`global-agents` / `global-claude` / `project-agents` / `project-claude`) + name.

- Managed skills are read-only (409): `skills update` would overwrite local edits; "copy" makes a local skill under a new name.
- New and copied skills go to `.agents/skills/` with a relative symlink in `.claude/skills/`, so both engines see them. Delete moves a local skill to `data/trash/skills/` and drops its link.
- Paths are realpath-checked inside the skill directory; names match `^[a-z0-9][\w.-]{0,63}$`. A project skill must resolve inside its project (a checkout's `.agents/skills/<name>` or `.claude/skills` symlink pointing elsewhere is ignored), and project-scoped writes are refused when the project's `.agents` / `.claude/skills` store links outside it. A `.claude/skills` linked wholesale to `.agents/skills` is treated as one store. Copy keeps inner symlinks as links, and a failed create removes its half-made directory. These roots are an allowlist of their own and do not relax the file browser's workspace check (SEC-007).

- Install / update / uninstall run the CLI (`skills/cli.ts`): `npx -y skills@1.7.4 …` as an argv list (no shell), telemetry off, one operation at a time (409 while busy), 5-minute timeout, cancellable (the UI keeps a running operation's sheet or dialog open until it ends or is cancelled); project scope is refused when the project directory is HOME; output lines are kept on the operation and polled by the UI. A repo preview installs `-s '*'` into a throwaway HOME (`add -l` has no JSON output) and reads each SKILL.md. Uninstall checks the names are installed first (the CLI reports success for unknown names). Sources must be `owner/repo` or `https://github.com/…`. Project scope runs in the project directory (lock `skills-lock.json`). Tests replace the CLI with `setSkillsCliRunner()`.

- Update status (`skills/updates.ts`): the lock's `skillFolderHash` is the git tree hash of the skill folder at install time; GitHub's tree API (`/repos/{source}/git/trees/{ref|HEAD}?recursive=1`, the lock entry's `ref` when it was installed from a branch or tag, one request per source repo and ref, `GITHUB_TOKEN`/`GH_TOKEN` if set, cached 10 min) gives the current one → `latest` / `update` / `removed` (folder gone from the repo) / `unknown` (also when GitHub truncated the tree and the folder is not in it). The UI offers "Update" only for `update`.
- Upload (`skills/upload.ts`): a `.md` (one SKILL.md) or a `.zip` / `.skill` archive with SKILL.md at its root or in top-level folders; streamed by `parseMultipartUpload()` (20 MB), unpacked with `fflate` after checking every entry (no `..` / absolute paths, ≤ 1000 files, ≤ 50 MB unpacked); a SKILL.md without a valid `name` and a `description` is skipped, as the CLI would skip it; skills are placed like created ones and never overwrite an existing name (reported as conflicts). The route is on the multipart allowlist in `app.ts`.

Routes: `GET /api/skills?projectId=` (also `cliAvailable`), `GET /api/skills/updates`, `POST /api/skills/upload` (multipart), `POST /api/skills/operations` (`preview` / `add` / `update` / `remove`), `GET /api/skills/operations/:id`, `POST /api/skills/operations/:id/cancel`, `POST /api/skills`, `GET /api/skills/:location/:name/files`, `GET|PUT /api/skills/:location/:name/file`, `POST /api/skills/:location/:name/copy`, `DELETE /api/skills/:location/:name`.

#### Background Jobs (built-in cron actions, `cron/actions/builtins/`)

Registered as `builtin` actions and scheduled through the cron system (see Cron System):

- `upload-cleanup` (hourly) — deletes files in `data/uploads/` older than 7 days
- `worktree-cleanup` (every 30 min, also on startup) — removes worktrees of `done` issues older than 1 day and of deleted issues; gated by the `worktree:autoCleanup` setting
- `log-cleanup` (daily at 03:00) — trims cron job logs to the last 1000 per job
- `issue-log-retention` (daily at 04:00) — deletes issue logs of `done` issues older than `log:retentionDays` (default 30)
- `message-cleanup` (daily at 05:00) — soft-deletes messages in a terminal state (`applied` / `withdrawn` / `closed`) unchanged for 1 day, and read notifications unchanged for 7 days; `open`, `decided` and `replied` are never removed

#### Upgrade (`upgrade/`)

BKD does not update itself. It runs as a child of the [lode](https://github.com/bkhq/lode) supervisor, which fetches `bkd-server.tar.gz` from GitHub Releases, verifies sha256 + the ed25519 asset signature, installs it under `<dir>/versions/<version>/`, and restarts BKD — rolling back automatically if the new version dies inside `health_grace` or misses its readiness signal.

- `lode-sdk.ts` — vendored verbatim from [`bkhq/lode`](https://github.com/bkhq/lode) `sdks/lode.ts` (zero-dep, eslint-ignored; update by re-copying the file).
- `service.ts` — the only app-side surface: reads lode's `state.json` and writes the request fields the app owns (`target`, `restart_nonce`, `ready`).
- `server-main.ts` calls `reportReady()` once `Bun.serve()` is listening (`[supervise].readiness = "state"`); lode drives every restart via SIGTERM, handled by the existing graceful shutdown.
- `ROOT_DIR` (env, or `[env]` in lode.toml) pins the install root so `data/` survives upgrades — lode runs BKD with its cwd set to the per-version directory.
- Update *policy* lives in `lode.toml` and is operator-owned; the UI can request an update/rollback/restart but cannot change policy. lode reports lifecycle status, not download progress.

Deployment, migration from the old launcher, and the `lode.toml` reference: `docs/deployment.md`.

### Frontend (`apps/frontend/src/`)

- **Framework**: React 19 + Vite 8 + TypeScript
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` + shadcn/ui components
- **Routing**: react-router-dom v7 (all pages lazy-loaded)
- **Data fetching**: TanStack React Query v5 (`staleTime: 30s`, `retry: 1`)
- **Drag & drop**: @dnd-kit/core + @dnd-kit/sortable for issue drag on the kanban board and list panel (`components/issue-drag/`); @atlaskit/pragmatic-drag-and-drop only for HomePage project ordering
- **Syntax highlighting**: Shiki (slim bundle via custom Vite plugin)
- **i18n**: i18next + react-i18next, Chinese (zh, default) and English (en). Translations in `src/i18n/{en,zh}.json`
- **Path alias**: `@/*` maps to `src/*`
- **Dev URL routing**: dev scripts wrap servers in `nsl run` so `http://bkd.localhost/api/*` reaches the API and the rest reaches Vite. This is the only dev entry — Vite no longer has a `/api/*` proxy.

#### Frontend Routes

```
/                                    → HomePage (project dashboard)
/projects/:projectId                 → KanbanPage (board view)
/projects/:projectId/issues          → IssueDetailPage (list + chat)
/projects/:projectId/issues/:issueId → IssueDetailPage (specific issue)
/review[/:projectId/:issueId]        → ReviewPage (global review queue)
/terminal                            → TerminalPage
/cron                                → CronPage
/messages                            → MessagesPage (global inbox: decisions + notifications; /decisions redirects here)
/skills                              → SkillsPage (agent skills: browse, edit, create, copy)
/sessions                            → SessionsPage (local engine sessions)
```

Four global drawers (lazy-mounted when open): `TerminalDrawer`, `FileBrowserDrawer`, `ProcessManagerDrawer`, `NotesDrawer`.

#### State Management

- **TanStack React Query** — All server state. Hooks in `hooks/use-kanban.ts`. Query keys use `queryKeys` factory.
- **Zustand stores** — Local UI state only:
  - `panel-store.ts` — Side panel and create dialog open/close.
  - `view-mode-store.ts` — Kanban/list toggle (persisted in localStorage).
  - `terminal-store.ts` / `terminal-session-store.ts` — Terminal drawer state + xterm.js session.
  - `file-browser-store.ts` — File browser drawer state + current path.
  - `process-manager-store.ts` — Process manager drawer state.

#### Real-Time Data Flow

```
Server (IssueEngine) → SSE /api/events → EventBus singleton (lib/event-bus.ts)
  → log events → useIssueStream hook → liveLogs state (capped at 500, ULID dedup)
  → state/done events → React Query cache invalidation → component re-renders
  → issue-updated → projects query invalidation
  → changes-summary → useChangesSummary hook
```

`EventBus`: single `EventSource` to `/api/events` with exponential backoff reconnection and 35s heartbeat watchdog. On reconnect: invalidates all React Query caches.

`useIssueStream` (most complex hook): fetches historical logs via HTTP, subscribes to SSE for real-time updates. Two arrays: `liveLogs` (capped at 500) and `olderLogs` (user-loaded pages). ULID-based deduplication.

#### Component Areas

- `components/ui/` — shadcn/ui primitives
- `components/kanban/` — Kanban board: columns, cards, sidebar, create issue dialog, header
- `components/issue-detail/` — Issue detail page: chat area (`ChatBody`), diff panel, issue list, chat input (attachments, slash commands, model selector)
- `components/files/` — File browser: breadcrumbs, directory listing, file viewer (Shiki + markdown)
- `components/terminal/` — xterm.js WebSocket terminal
- `components/processes/` — Active engine process list

### Shared Types (`packages/shared/`)

`@bkd/shared` contains TypeScript types used by both backend and frontend. Frontend re-exports via `types/kanban.ts`. Key types: `Project`, `Issue`, `NormalizedLogEntry`, `ToolAction`, `EngineType`, `SessionStatus`, `ApiResponse<T>`.

## Conventions

- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`)
- Linting & formatting: @antfu/eslint-config (`eslint.config.js` at root) — no semicolons, single quotes, 2-space indent
  - **Important**: ESLint enforces `import * as z from 'zod'` (not `import { z } from 'zod'`) via `no-restricted-imports`
  - Import types must use `import type` (separated style) via `@typescript-eslint/consistent-type-imports`
  - Node.js imports must use `node:` prefix
- **TypeScript runs two majors on purpose.** The catalog pins `^7.0.2`, used by
  `@bkd/api`, `@bkd/frontend` and `@bkd/shared`; `@bkd/root` keeps an
  off-catalog `typescript: ^6.0.3`. typescript-eslint throws
  `typescript-eslint does not support TS 7.0` at plugin load, so ESLint needs a
  v6 to resolve from the repository root, while `tsc` in each workspace gets the
  native v7 (about 4.6x faster: 14.2s -> 3.1s for a full typecheck). Do not
  "unify" the root back onto `catalog:` — that breaks `bun run lint` outright.
  Delete the root pin once typescript-eslint supports TS >= 7.1
  (typescript-eslint#10940). Because the root and the workspaces resolve
  different `tsc` binaries, always typecheck with `bun run typecheck`, never a
  bare `bunx tsc` from the root.
- Frontend tests: vitest + @testing-library/react (`bun run test:frontend`)
- Backend tests: `bun:test` (`bun run test:api`). Tests use preload to set `DB_PATH` to an isolated temp DB.
- Dev env is consolidated in a single **root `.env`** (gitignored; copy from root `.env.example`). `bun run dev` loads it via `bun --env-file=.env`; `dev:api` loads it via `bun --env-file=../../.env`; the Vite dev server reads it through `loadEnv(mode, <repo root>)` in `vite.config.ts`. nsl routes `http://bkd.localhost/api/*` → API and the rest → Vite. Do not use the `dotenv` package. `apps/api/.env` still serves production `start` and drizzle (CWD auto-load); keep dev values in sync there or rely on the root `.env`.
- IDs: ULID for logs/attachments/tool calls, nanoid 8-char for projects/issues
- Shared types live in `packages/shared/src/index.ts`
- API client in `apps/frontend/src/lib/kanban-api.ts` — add new endpoints here, wrap in React Query hooks in `use-kanban.ts`
- All user-facing strings must have i18n keys in both `en.json` and `zh.json`
- REST routes must use shared Zod schemas and OpenAPI metadata; multipart handlers must explicitly validate the same schemas. See `AGENTS.md` for the API and quality-gate baseline.
- All route handlers must verify project existence and cross-project ownership
- Dependency versions shared across workspaces are managed via Catalogs in root `package.json`
- Component styling: `cn()` utility combining `clsx` + `tailwind-merge`, with `class-variance-authority` for variants
- Soft deletion everywhere — `isDeleted` flag, never hard-delete rows

### Adding a New API Endpoint (end-to-end)

1. Define shared types in `packages/shared/src/index.ts`
2. Add route + Zod schema in `apps/api/src/routes/` (verify project ownership for scoped routes)
3. Add API client function in `apps/frontend/src/lib/kanban-api.ts`
4. Add React Query hook in `apps/frontend/src/hooks/use-kanban.ts` (add query key to `queryKeys` factory)
5. Wire into component
6. Add i18n keys in both `en.json` and `zh.json`

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

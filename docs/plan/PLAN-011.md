# PLAN-011 `fix-db` CLI command on the main bkd entry

- **status**: completed
- **createdAt**: 2026-05-16

## Context (Investigation)

Entrypoints:

- Full compiled binary + dev + package `server.js`: `apps/api/src/index.ts`.
  No CLI parsing. `import app from './app'` transitively imports
  `apps/api/src/db/index.ts`, whose top-level code runs `runMigrations()` +
  `verifySchema()` (the latter `process.exit(1)` on schema mismatch).
- Launcher binary: `scripts/launcher.ts`, has `--fix-db` →
  `repairDatabase(dbPath, migrationsDir)` then dynamically imports server.js.

Migration source resolution (mirrors `db/index.ts:32-71`):

- dev: `apps/api/drizzle`
- package mode: `APP_DIR/migrations`
- full compiled binary: `embeddedMigrations` map → written to a tmp dir

Root-cause relevance: `db/index.ts:39-54 runMigrations` catches
"table/index already exists" and **silences without applying the rest of the
chain**; launcher `repairDatabase` ROLLBACKs on any error. Neither recovers a
DB whose `__drizzle_migrations` is hash-inconsistent with the (re-aligned)
migration history, leaving 0020 unapplied.

## Proposal

1. New module `apps/api/src/db/repair.ts` exporting
   `repairDatabase(opts: { dbPath: string, migrationsDir: string }): { applied: number }`.
   - Pure `bun:sqlite` + `node:crypto` (no drizzle-orm), so the launcher can
     also reuse it later if desired.
   - Iterate `meta/_journal.json` entries in order. For each not present in
     `__drizzle_migrations` (match by sql hash, not timestamp), split on
     `--> statement-breakpoint` and run each statement; if a statement throws
     and the message matches `/(table|index) .+ already exists/i` (or
     `duplicate column name`), skip that statement and continue; any other
     error aborts with a clear message.
   - After a migration's statements succeed/skip, insert its hash into
     `__drizzle_migrations` so subsequent normal startup is consistent.
   - `PRAGMA foreign_keys = OFF` during repair, restored after.
2. `apps/api/src/index.ts`: at the very top, before any
   `import ... from './app'`, parse argv for the `fix-db` subcommand
   (`bkd fix-db`) and `--fix-db` flag. If present:
   - resolve dbPath + migrations source the same way `db/index.ts` does
     (factor a small `resolveMigrationsDir()` helper, reused by both),
   - call `repairDatabase(...)`, log result, `process.exit(0/1)`.
   - This branch must not import `./app` or `./db` (avoid the migrate+verify
     side-effect) — only import `db/repair.ts` + a path resolver.
3. Refactor `apps/api/src/db/index.ts` minimally: extract migrations-dir /
   embedded-tmp resolution into an exported helper so both the normal startup
   path and the `fix-db` branch use one implementation (no duplicated logic).
4. Docs: add a short "Repairing the database" note (README or
   `docs/architecture.md` DB section) and `bkd fix-db` usage.

Out of scope: changing `db/index.ts runMigrations` silencing behavior or
`verifySchema` (separate concern; `fix-db` is the operator escape hatch). The
launcher's existing `--fix-db` is left as-is in this task (can be pointed at
the shared module in a follow-up).

## Risks

- `index.ts` top-of-file ordering: must intercept argv before the `./app`
  import chain executes the db side-effect. Mitigated by putting the branch
  first and dynamic-importing only `db/repair.ts`.
- Embedded-binary mode: migrations only exist as `embeddedMigrations`; the
  resolver must write them to tmp (reuse `db/index.ts` logic) — covered by
  step 3.
- Statement-level "already exists" tolerance could mask a genuinely broken
  migration. Mitigated: only swallow the specific
  already-exists/duplicate-column messages; everything else aborts loudly.

## Scope

- New: `apps/api/src/db/repair.ts`
- Edit: `apps/api/src/index.ts` (early argv branch), `apps/api/src/db/index.ts`
  (extract migrations-dir resolver, export it)
- Docs: `docs/architecture.md` (or README) DB repair note
- Test: `apps/api/test/` — repair applies a pending migration on a DB missing
  it; repair tolerates a pre-existing table; idempotent re-run is a no-op.

## Alternatives

- A) Mirror launcher's `repairDatabase` into index.ts as a flag only
  (ROLLBACK-on-error). Smaller, but does NOT fix the real "already exists"
  case — the command would fail on exactly the DBs that need it. Rejected.
- B) Make `db/index.ts runMigrations` itself "already exists"-tolerant so no
  manual command is needed. Larger blast radius (every startup), riskier;
  user explicitly asked for an explicit CLI command. Deferred.
- C) (chosen) Shared idempotent `repair.ts` + explicit `fix-db` command on the
  main entry.

## Verification

- `bun run test:api` (new repair tests green)
- Manual: create DB, drop a late migration's column, run
  `bun apps/api/src/index.ts fix-db` → column restored, server starts clean
- `bun run lint` + `tsc --noEmit` for api

## Implementation Notes (2026-05-16)

Deviation from proposal step 2: the "static side-effect import first" mitigation
does NOT hold in Bun — with a top-level `await import()` in a first-imported
module, Bun still evaluates sibling static imports (`./app` → `./db`), so
`verifySchema()` / engine probe / pid-lock ran during `fix-db` (observed
`schema_verification_passed`, `probe_started`, plus a pino exit crash).

Final design: `index.ts` is now a thin dispatcher with **no static app/db
imports**. The server bootstrap moved verbatim to `apps/api/src/server-main.ts`.
`index.ts` checks argv and either `await import('./db/repair')` (fix-db path) or
`await import('./server-main')` (normal path). Dynamic import guarantees the
server side-effect never loads on the fix-db path.

Delivered files:
- New: `apps/api/src/db/migrations-source.ts`, `apps/api/src/db/repair.ts`,
  `apps/api/src/server-main.ts`, `apps/api/test/db-repair.test.ts`
- Rewritten: `apps/api/src/index.ts` (dispatcher)
- Refactored: `apps/api/src/db/index.ts` (uses shared resolver, duplication removed)
- Docs: `docs/architecture.md` Database section

Verification (all green):
- `apps/api` lint + `tsc --noEmit` clean
- Full api suite: 498 pass, 1 skip, 0 fail (34 files)
- E2E: `bun src/index.ts fix-db` on empty DB → applied 21 real migrations,
  exit 0, NO server side-effects (server-main not loaded); `--fix-db` variant
  identical; normal `bun src/index.ts` boots fully (no regression)

Out of scope (unchanged): `db/index.ts runMigrations` silencing, `verifySchema`,
launcher's own `--fix-db`.

## Follow-up CLI-002 (2026-05-16)

Launcher `--fix-db` now reuses the shared implementation: deleted
`scripts/launcher.ts` `repairDatabase()` (~80 lines) and the step-5 block;
`--fix-db` is delegated to the bundled server.js dispatcher (same process,
same `process.argv`). One repair implementation across all modes.

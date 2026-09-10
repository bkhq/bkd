# 20260910-0533-uploads-root-dir Resolve data paths from a single DATA_DIR

- **status**: completed
- **createdAt**: 2026-09-10 05:33
- **approvedAt**: 2026-09-10 05:52
- **relatedTask**: 20260910-0528-uploads-root-dir

## Context

### The reported defect

`apps/api/src/uploads.ts:5` is the only persistent path derived from the process cwd:

```ts
export const UPLOAD_DIR = resolve(process.cwd(), 'data/uploads')
```

`docs/deployment.md:121` states that lode runs BKD with its cwd set to
`<dir>/versions/<version>/`, which changes on every upgrade. Attachment rows store the
relative `storagePath` `data/uploads/<storedName>`, so after an upgrade they resolve against
the new version directory, the file is missing, and the API answers
`404 Attachment file missing`. Once lode prunes the old version directory those files are
gone. On this checkout the split is already visible: `data/db`, `data/logs` and `data/test`
sit in the repo root while 251 attachment files sit in `apps/api/data/uploads` — the cwd of
`bun --filter @bkd/api dev`.

### The wider inconsistency

`BKD_DATA_DIR` is the documented override for the data directory
(`docs/deployment.md:214` lists it as the successor to the launcher's `--data-dir`;
`docs/bkd.lode.toml:65-67` records the defaults as ROOT_DIR-relative `data/`,
`data/db/bkd.db`, `worktrees`). Only one consumer implements it:

| Consumer | Current base | Honours `BKD_DATA_DIR` |
|---|---|---|
| `pid-lock.ts:30` | `BKD_DATA_DIR` ?? `ROOT_DIR/data` | yes |
| `logger.ts:12` | `ROOT_DIR/data/logs` | no |
| `routes/settings/system-logs.ts:13` | `ROOT_DIR/data/logs/bkd.log` | no |
| `routes/settings/cleanup.ts:22` | `ROOT_DIR/data/logs/issues` | no |
| `engines/issue/debug-log.ts:9` | `ROOT_DIR/data/logs/issues` | no |
| `engines/executors/claude/executor.ts:28` | `ROOT_DIR/data/logs/issues` | no |
| `db/migrations-source.ts:19` | `DB_PATH` ?? `ROOT_DIR/data/db/bkd.db` | no |
| `uploads.ts:5` | **`<cwd>/data/uploads`** | no |

Neither `.env.example` nor `apps/api/.env.example` documents `BKD_DATA_DIR`.

Path-type env vars are read straight from `process.env` throughout (`root.ts:22`,
`migrations-source.ts:18`, `pid-lock.ts:30`); `runtime-config.ts` covers only the
non-path settings, and `root.ts` deliberately imports nothing app-level. A `DATA_DIR`
constant therefore belongs in `root.ts` next to `ROOT_DIR`.

`WORKTREE_DIR` (`engines/issue/utils/worktree.ts:10`) is a sibling of `data/`, not a child —
it stays ROOT_DIR-relative and is out of scope.

### Upload consumers

Producers: `routes/issues/create.ts:181`, `routes/issues/message.ts:184`,
`engines/issue/pipeline/extract-images.ts:58`.
Consumers: `routes/issues/attachments.ts:53` (`resolve(process.cwd(), storagePath)` plus a
`startsWith(UPLOAD_DIR)` guard, SEC-025), `db/pending-messages.ts:305` and
`routes/issues/message.ts:32` (both build the `[Attached file: … at <abs path>]` prompt
supplement), and `cron/actions/builtins/upload-cleanup.ts:5`, which recomputes
`resolve(process.cwd(), 'data/uploads')` instead of importing `UPLOAD_DIR`.

The file-browser upload path (`routes/files.ts:335`) writes into the workspace directory
addressed by the base58 `:root` param and is unrelated — out of scope.

### Test coverage today

`test/extract-images.test.ts:42,81` assert the stored file exists at
`resolve(process.cwd(), rows[0].storagePath)`. Under `cd apps/api && bun test` the cwd is
`apps/api`, so those assertions encode the current (wrong) base and go RED once the base
moves. No test asserts that the upload base is independent of the cwd.

## Proposal

Scope option B (approved): converge every `data/`-relative path on one constant.

### 1. `apps/api/src/root.ts` — add `DATA_DIR`

```ts
/**
 * Persistent data directory. `BKD_DATA_DIR` overrides it (documented in
 * docs/deployment.md as the successor to the launcher's --data-dir);
 * otherwise it is `<ROOT_DIR>/data`.
 */
export const DATA_DIR = process.env.BKD_DATA_DIR
  ? resolve(process.env.BKD_DATA_DIR)
  : resolve(ROOT_DIR, 'data')
```

### 2. Repoint every consumer

| File | From | To |
|---|---|---|
| `uploads.ts:5` | `resolve(process.cwd(), 'data/uploads')` | `resolve(DATA_DIR, 'uploads')` |
| `logger.ts:12` | `join(ROOT_DIR, 'data', 'logs')` | `join(DATA_DIR, 'logs')` |
| `settings/system-logs.ts:13` | `join(ROOT_DIR, 'data', 'logs', 'bkd.log')` | `join(DATA_DIR, 'logs', 'bkd.log')` |
| `settings/cleanup.ts:22` | `join(ROOT_DIR, 'data', 'logs', 'issues')` | `join(DATA_DIR, 'logs', 'issues')` |
| `engines/issue/debug-log.ts:9` | same | `join(DATA_DIR, 'logs', 'issues')` |
| `executors/claude/executor.ts:28` | same | `join(DATA_DIR, 'logs', 'issues')` |
| `pid-lock.ts:30-32` | inline `BKD_DATA_DIR` ?? `ROOT_DIR/data` | `DATA_DIR` |
| `cron/actions/builtins/upload-cleanup.ts:5` | local `resolve(process.cwd(), …)` | import `UPLOAD_DIR` |

**`db/migrations-source.ts:19` — `DATA_DIR` is the single base here too.** An absolute
`DB_PATH` is used verbatim, a relative one resolves inside `DATA_DIR`, and the default is
`<DATA_DIR>/db/bkd.db`. The shipped example changes from `data/db/bkd.db` (ROOT_DIR-relative)
to `db/bkd.db`, and an install still carrying the old relative form falls back to its
populated file rather than opening an empty database beside it:

```ts
const raw = process.env.DB_PATH
if (!raw) return resolve(DATA_DIR, 'db/bkd.db')
if (raw.startsWith('/')) return raw

const path = resolve(DATA_DIR, raw)
if (existsSync(path)) return path

const legacyPath = resolve(ROOT_DIR, raw)
return existsSync(legacyPath) ? legacyPath : path
```

`pid-lock.ts` and `db/reset.ts` each re-parsed `DB_PATH` with their own copy of the old
rule; both now call `resolveDbPath()` so there is one implementation.

### 3. `routes/issues/attachments.ts` — resolve from `UPLOAD_DIR`, with a legacy fallback

Files written before this change live under the old cwd. Prefer the new location, fall back
to the pre-change one only when the primary file is absent, and keep the SEC-025 containment
check on each candidate against its own base:

```ts
const filePath = resolve(UPLOAD_DIR, attachment.storedName)   // primary
const legacyPath = resolve(process.cwd(), attachment.storagePath) // pre-DATA_DIR writes
```

### 4. Documentation

Add `BKD_DATA_DIR` to `.env.example` and `apps/api/.env.example` alongside `ROOT_DIR` /
`DB_PATH`.

### 5. Tests (RED first)

- New `test/data-dir.test.ts`: `DATA_DIR` honours `BKD_DATA_DIR`, defaults to
  `<ROOT_DIR>/data`, and `UPLOAD_DIR` equals `<DATA_DIR>/uploads` regardless of cwd.
- `test/extract-images.test.ts:42,81`: assert against `UPLOAD_DIR`.
- Attachment serving: a row whose file exists only at the legacy cwd location is still
  served.

### 6. Existing files (operator action, not code)

```bash
mv apps/api/data/uploads/* data/uploads/   # dev checkout, 251 files
```

The fallback keeps them served either way; moving them is what puts them back under the
cleanup job.

## Risks

- **Deployments that already set `BKD_DATA_DIR`** see logs, the default DB path, and uploads
  move to that directory. This is the documented behaviour finally taking effect, but it is a
  real change for anyone who set the variable while only `pid-lock` honoured it. Such installs
  almost certainly also set `DB_PATH` (which keeps its own resolution), and
  `scripts/migrate-to-lode.ts:113` already warns about this combination.
- **Attachments written under the old cwd base** are covered by the read fallback only while
  that directory still exists; a lode install that has pruned the version directory holding
  them cannot be recovered by any code change.
- **`upload-cleanup` no longer prunes the legacy directory**, so old files linger until moved
  or deleted by hand. Deleting from a cwd-derived directory on a live install is riskier than
  leaking a bounded set of files — deliberate.
- **The read fallback widens the accepted path set.** Contained by validating each candidate
  against its own base before opening it; `storedName` is a generated ULID plus extension and
  is never user-controlled.
- **A relative `DB_PATH` changes meaning**: `data/db/bkd.db` used to mean
  `<ROOT_DIR>/data/db/bkd.db` and now means `<DATA_DIR>/data/db/bkd.db`. Covered by the
  existence fallback above, so an existing database is never shadowed by an empty one; the
  shipped examples and `docs/development.md` move to the `db/bkd.db` form. `docs/bkd.lode.toml`
  already suggests an absolute path, which is unaffected.
- No schema change, no API contract change, no frontend change.

## Scope

10 source files plus 3 test files:

`root.ts`, `uploads.ts`, `logger.ts`, `routes/settings/system-logs.ts`,
`routes/settings/cleanup.ts`, `engines/issue/debug-log.ts`,
`engines/executors/claude/executor.ts`, `pid-lock.ts`, `db/migrations-source.ts`,
`cron/actions/builtins/upload-cleanup.ts`, `routes/issues/attachments.ts`, `db/reset.ts`;
`.env.example`, `apps/api/.env.example`, `docs/development.md`, `scripts/migrate-to-lode.ts`;
`test/data-dir.test.ts` (new), `test/api-attachments.test.ts` (new),
`test/extract-images.test.ts`.

Verification: `bun run test:api`, then `bun run check`.

## Alternatives

1. **Narrow scope A** — only `uploads.ts` and `pid-lock.ts` use `DATA_DIR`. Smaller blast
   radius, but leaves logs and the DB ignoring `BKD_DATA_DIR`; the half-implemented variable
   is the underlying bug. Rejected by the user in favour of B.
2. **`ROOT_DIR`-only fix** — `resolve(ROOT_DIR, 'data/uploads')`, ignoring `BKD_DATA_DIR`.
   Fixes the upgrade data loss but keeps uploads inconsistent with the documented override.
   Rejected.
3. **One-time move at startup** — rename `<cwd>/data/uploads/*` into the new location on boot.
   Self-healing, but bulk filesystem writes during startup, fails across filesystems, and
   races a second instance. Rejected as too much risk for a path fix.
4. **No fallback** — smallest diff; every pre-existing attachment 404s. Rejected.

## Annotations

- 2026-09-10 — user: base the fix on the data directory, not `ROOT_DIR` directly, and apply
  scope B (converge all consumers).
- 2026-09-10 — user: `DB_PATH` must resolve from `DATA_DIR` as well; `DATA_DIR` is the single
  source and falls back to a `ROOT_DIR`-relative default when `BKD_DATA_DIR` is unset. The
  first implementation kept a relative `DB_PATH` on `ROOT_DIR`, which left exactly the kind of
  exception this task set out to remove. Reworked, with an existence fallback so installs
  carrying the old relative form keep their database.

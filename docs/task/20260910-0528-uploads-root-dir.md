# 20260910-0528-uploads-root-dir Resolve data paths from a single DATA_DIR

- **status**: completed
- **priority**: P1
- **owner**: claude/session-uploads-rootdir
- **createdAt**: 2026-09-10 05:28

## Description

Two related defects in how persistent paths are resolved.

**1. Uploads are cwd-relative.** `UPLOAD_DIR` is derived from `process.cwd()`
(`apps/api/src/uploads.ts:5`), while every other persistent path is derived from `ROOT_DIR`.
`docs/deployment.md:121` states that lode runs BKD with its cwd set to
`<dir>/versions/<version>/`, which changes on every upgrade, so attachments are written into
the per-version directory instead of the installation root. After an upgrade, rows whose
`storagePath` is `data/uploads/<file>` resolve against the new version directory, the file is
missing, and the API answers `404 Attachment file missing`; once lode prunes old version
directories those files are gone. In dev the same split already exists: `data/db` and
`data/logs` sit in the repo root while uploads land in `apps/api/data/uploads`.

**2. `BKD_DATA_DIR` is only half implemented.** It is the documented override for the data
directory (`docs/deployment.md:214`, successor to the launcher's `--data-dir`;
`docs/bkd.lode.toml:65-67`), but only `pid-lock.ts:30` reads it. `logger.ts:12`,
`routes/settings/system-logs.ts:13`, `routes/settings/cleanup.ts:22`,
`engines/issue/debug-log.ts:9`, `engines/executors/claude/executor.ts:28` and
`db/migrations-source.ts:19` all hardcode `ROOT_DIR/data/...`, and neither `.env.example`
documents the variable.

Acceptance criteria:

- A single `DATA_DIR` constant (`BKD_DATA_DIR` ?? `<ROOT_DIR>/data`) backs every
  `data/`-relative path: uploads, logs, issue debug logs, the PID lock, and the default DB
  path.
- `UPLOAD_DIR` resolves to `<DATA_DIR>/uploads` in dev, package, and lode modes, independent
  of the cwd.
- `DB_PATH` resolves from `DATA_DIR` as well: absolute verbatim, relative inside
  `DATA_DIR`, default `<DATA_DIR>/db/bkd.db`, with an existence fallback so an install
  carrying the old `ROOT_DIR`-relative form keeps its database.
- Attachments stored before the change remain readable.
- Path-traversal protection (SEC-025) still holds for every resolution branch.
- `BKD_DATA_DIR` is documented in both `.env.example` files.

## ActiveForm

Resolving data paths from a single DATA_DIR

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-09-10 — scope widened from "uploads use ROOT_DIR" to "all data paths use
  DATA_DIR" after the user pointed out that `BKD_DATA_DIR` is the documented base for the
  data directory. Plan: `docs/plan/20260910-0533-uploads-root-dir.md` (option B).
- 2026-09-10 — reworked once more: the first implementation exempted a relative `DB_PATH`
  from `DATA_DIR`, which left the very exception the task exists to remove. `resolveDbPath()`
  is now the single implementation (also used by `pid-lock.ts` and `db/reset.ts`) and hangs
  off `DATA_DIR`.
- Out of scope, worth a follow-up task: `routes/settings/cleanup.ts`, `engines/issue/debug-log.ts`
  and `engines/executors/claude/executor.ts` each define an identical private `ISSUE_LOG_DIR`.

- complete: lint, typecheck, test:api (676 pass), test:frontend (96 pass) and build all green.

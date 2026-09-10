# BKD - Changelog

Change history for tasks, plans, and decisions. Entries are appended newest-last.

Entry format:

```markdown
## YYYY-MM-DD HH:MM [tag]

[content]
```

Tags: `[progress]`, `[BUG-P0]`, `[BUG-P1]`, `[pitfall]`, `[decision]`.

---

## 2026-09-10 02:10 [decision]

Realigned `docs/task/` and `docs/plan/` with the current PMA formats.

- Both index files documented the retired `PREFIX-NNN` / `PLAN-NNN` ID scheme and the
  "only update the checkbox marker; never delete the line" rule. Usage, Format, and Rules
  now follow the canonical templates: IDs are `<timestamp>-<feature-slug>` (UTC minute
  precision, no sequence numbers), entries may be revised or deleted, and change history
  is recorded here.
- Existing `PREFIX-NNN` / `PLAN-NNN` files keep their names — the format reference declares
  numbered files still valid and forbids renaming them without an explicit request.
- `AUDIT-001` and `PLAN-021` entries had been inserted above the Usage section of their
  index; both were moved into the `## Tasks` / `## Plans` lists.
- Detail-file metadata normalized to the allowed field/value sets, with the reasons moved
  into `Notes` / `Annotations`:
  - Plans: `PLAN-001`, `PLAN-002` (`implementing` -> `rejected`), `PLAN-003`, `PLAN-004`
    (free-text status -> `rejected`), `PLAN-011` (added `approvedAt`, `relatedTask`),
    `PLAN-012`, `PLAN-013`, `PLAN-021` (`task` -> `relatedTask`, added `approvedAt` /
    `createdAt`).
  - Tasks: `WB-001`..`WB-004` (`in_progress` / `completed` -> `closed`, matching the `[~]`
    markers left after the whiteboard removal), `ENG-001`, `ENG-002` (free-text status ->
    `closed`).
- Added this file; `docs/changelog.md` is a required PMA artifact and is referenced by both
  index files.
- Replaced the restated PMA rules in `AGENTS.md` / `CLAUDE.md` *Project Development* with a
  pointer to `/pma` plus the project-specific facts, per the project-injection reference.

---

## 2026-09-10 05:53 [BUG-P1]

Converged every `data/`-relative path on a single `DATA_DIR`
(`20260910-0528-uploads-root-dir` / `20260910-0533-uploads-root-dir`).

- `UPLOAD_DIR` was `resolve(process.cwd(), 'data/uploads')` — the only persistent path
  derived from the cwd. lode runs BKD from `<dir>/versions/<version>/`, so attachments were
  written into the per-version directory: after an upgrade they resolved against the new
  version dir (`404 Attachment file missing`), and pruning the old version dir deleted them.
  The same split was already visible in dev — `data/db` and `data/logs` in the repo root,
  251 attachment files under `apps/api/data/uploads`.
- `BKD_DATA_DIR` is the documented override for the data directory
  (`docs/deployment.md`, successor to the launcher's `--data-dir`), but only `pid-lock.ts`
  implemented it. `root.ts` now exports `resolveDataDir(env)` / `DATA_DIR`
  (`BKD_DATA_DIR` ?? `<ROOT_DIR>/data`), and uploads, the app log, issue debug logs, the
  cleanup route, the PID lock and the default DB path all hang off it.
- A relative `DB_PATH` deliberately keeps its `ROOT_DIR` base — `.env.example` ships
  `DB_PATH=data/db/bkd.db`, which would otherwise become `<DATA_DIR>/data/db/bkd.db`.
  Only the default moved to `DATA_DIR`.
- `GET .../attachments/:id` now resolves `storedName` inside `UPLOAD_DIR` and falls back to
  the pre-change cwd location when the primary file is absent, so attachments written before
  this change stay readable. Both branches keep the SEC-025 containment check, and the
  resolution no longer trusts the DB's `storagePath` string.
- `upload-cleanup` imports `UPLOAD_DIR` instead of recomputing it, so the base cannot drift
  again. It intentionally does not prune the legacy directory.
- `BKD_DATA_DIR` documented in both `.env.example` files.
- Dev checkout: the 251 files under `apps/api/data/uploads` were moved into `data/uploads`
  (no name collisions) and the empty `apps/api/data` tree removed.
- Verified: `bun run lint`, `bun run typecheck`, `bun run test:api` (676 pass),
  `bun run test:frontend` (96 pass), `bun run build`.

---

## 2026-09-10 06:14 [BUG-P1]

Follow-up to the `DATA_DIR` convergence: `DB_PATH` now resolves from `DATA_DIR` too
(`20260910-0528-uploads-root-dir`).

- The first pass kept a relative `DB_PATH` anchored at `ROOT_DIR` to protect the shipped
  `DB_PATH=data/db/bkd.db` example. That preserved exactly the kind of exception the task
  set out to remove, leaving `DATA_DIR` as "the single source, except for the database".
- `resolveDbPath()` now treats `DATA_DIR` as the only base: absolute `DB_PATH` verbatim,
  relative resolved inside `DATA_DIR`, default `<DATA_DIR>/db/bkd.db`. With `BKD_DATA_DIR`
  unset the default is byte-identical to the old `<ROOT_DIR>/data/db/bkd.db`.
- Compatibility: a relative `DB_PATH` changes meaning (`data/db/bkd.db` was
  `<ROOT_DIR>/data/db/bkd.db`, now `<DATA_DIR>/data/db/bkd.db`). When the new location holds
  no database but the old one does, the old file is used — an empty database created beside a
  populated one is indistinguishable from data loss. `docs/bkd.lode.toml` already suggests an
  absolute path and is unaffected.
- `pid-lock.ts` and `db/reset.ts` each carried their own copy of the old parsing rule; both
  now call `resolveDbPath()`, so there is a single implementation.
- Shipped examples moved to the `DATA_DIR`-relative form (`DB_PATH=db/bkd.db`) in both
  `.env.example` files; `docs/development.md` gained a `BKD_DATA_DIR` row and the corrected
  `DB_PATH` default; the stale "ROOT_DIR-relative defaults" comment in
  `scripts/migrate-to-lode.ts` was fixed.
- Verified: `bun run lint`, `bun run typecheck`, `bun run test:api` (677 pass),
  `bun run test:frontend` (96 pass), `bun run build`.

---

## 2026-09-10 07:26 [decision]

Dropped Claude Fable 5 from the `claude-code` model catalog, keeping only 5.1
(`20260910-0724-drop-fable-5`).

- `CLAUDE_MODELS` no longer lists `claude-fable-5` / `claude-fable-5[1m]`; the 5.1 pair and
  the Opus/Sonnet entries are unchanged.
- This reverses the reason 86f9d78 kept Fable 5 listed. `pickExecutionModel` keeps a pinned
  selection only while it exists in the catalog, so an issue pinned to `claude-fable-5` now
  resolves to the catalog default (`claude-opus-5`) on its next execution rather than staying
  on Fable 5. Requested with that behaviour understood; no data migration — the stored
  `model` value is simply no longer matched.
- Verified: `bun run lint` (0 errors), `bun run typecheck`, `bun run test:api`
  (677 pass), `bun run test:frontend` (96 pass), `bun run build`.

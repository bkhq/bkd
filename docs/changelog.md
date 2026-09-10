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

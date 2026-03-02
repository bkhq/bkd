# PLAN-001 Migrate task workflow from /ptask to /pma

- status: completed
- task: ENG-003
- owner: codex
- createdAt: 2026-02-28 05:40 UTC
- updatedAt: 2026-02-28 05:47 UTC

## Context
- Existing project workflow uses `/ptask` and tracks tasks in `task.md`.
- PMA-required structure (`docs/task/*`, `docs/plan/*`, `docs/changelog.md`, `docs/architecture.md`) was missing.
- AGENTS/CLAUDE did not include a PMA `/pma` project development section.

## Proposal
- Add PMA canonical format files, index files, and initial detail files.
- Migrate currently in-progress tasks to PMA task files to preserve ownership/status.
- Update AGENTS/CLAUDE instructions to PMA three-phase workflow and PMA paths.

## Risks
- Dual tracking can drift during transition if both `task.md` and `docs/task/*` are edited independently.
- Existing automation may still expect legacy `task.md` behavior.

## Scope
- Create PMA docs scaffolding and populate initial content.
- Keep legacy `task.md` for historical reference.
- Do not alter runtime backend/frontend behavior.

## Alternatives
- Keep `/ptask` as primary workflow and skip migration.
- Hybrid mode with `/ptask` primary and PMA docs as optional references.

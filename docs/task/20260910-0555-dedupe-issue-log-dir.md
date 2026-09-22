# 20260910-0555-dedupe-issue-log-dir Deduplicate the ISSUE_LOG_DIR constant

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-09-10 05:55

## Description

Three modules define an identical private `ISSUE_LOG_DIR`:

- `apps/api/src/routes/settings/cleanup.ts:22`
- `apps/api/src/engines/issue/debug-log.ts:9`
- `apps/api/src/engines/executors/claude/executor.ts:28`

All three are now `join(DATA_DIR, 'logs', 'issues')` after
`20260910-0528-uploads-root-dir`. Export it once (next to `DATA_DIR`, or from
`engines/issue/debug-log.ts`, which owns the directory) and import it in the other two, so
the path cannot drift the way `UPLOAD_DIR` did.

Noted while widening that task's scope; deliberately left out of it to keep the diff to the
path fix.

## ActiveForm

Deduplicating the ISSUE_LOG_DIR constant

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(Implementation notes, progress logs, or related links.)

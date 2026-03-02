# Task Format

Use this format for all PMA task tracking files.

## Index File: `docs/task/index.md`

```md
# Task Index

> Updated: YYYY-MM-DD HH:MM UTC

- [ ] **PREFIX-NNN Short imperative title** `P1` - owner: codex - file: `docs/task/PREFIX-NNN.md`
```

Status markers:

- `[ ]` pending
- `[-]` in progress
- `[x]` completed
- `[~]` closed / won't do

## Detail File: `docs/task/PREFIX-NNN.md`

```md
# PREFIX-NNN Short imperative title

- status: pending | in_progress | completed | closed
- priority: P0 | P1 | P2 | P3
- owner: codex
- createdAt: YYYY-MM-DD HH:MM UTC
- updatedAt: YYYY-MM-DD HH:MM UTC

## Summary
One paragraph describing background and target outcome.

## Scope
- In-scope item 1
- In-scope item 2

## Acceptance Criteria
- Verifiable result 1
- Verifiable result 2

## Notes
- Optional implementation notes, risks, and links.
```

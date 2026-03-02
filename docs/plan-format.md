# Plan Format

Use this format for non-trivial PMA plans.

## Index File: `docs/plan/index.md`

```md
# Plan Index

> Updated: YYYY-MM-DD HH:MM UTC

- [ ] **PLAN-NNN Short plan title** - task: `PREFIX-NNN` - owner: codex - file: `docs/plan/PLAN-NNN.md`
```

Status markers:

- `[ ]` drafted
- `[-]` implementing
- `[x]` completed
- `[~]` closed

## Detail File: `docs/plan/PLAN-NNN.md`

```md
# PLAN-NNN Short plan title

- status: drafted | implementing | completed | closed
- task: PREFIX-NNN
- owner: codex
- createdAt: YYYY-MM-DD HH:MM UTC
- updatedAt: YYYY-MM-DD HH:MM UTC

## Context
Current state and investigation findings.

## Proposal
Concrete implementation approach.

## Risks
Known risks and mitigation.

## Scope
- Included work item 1
- Included work item 2

## Alternatives
- Option A with tradeoff
- Option B with tradeoff
```

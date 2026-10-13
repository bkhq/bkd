# 20261013-0538-bkd-log-rotation Rotate data/logs/bkd.log and keep data/ out of ESLint

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-10-13 05:38

## Description

`data/logs/bkd.log` has no rotation and reached 73 GB on the dev machine. Root `eslint .` stalls on it (killed after 10 min) even though `data/` is gitignored; with `--ignore-pattern 'data/**'` the same run takes 15s.

Acceptance: the server log rotates or is size-capped; `data/**` is in the ESLint ignores; `bun run lint` finishes in normal time.

## ActiveForm

Adding log rotation.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Found while verifying `20261013-0244-worktree-cleanup-on-delete`.

# 20261013-0538-spawn-leak-tests-order-dependent Fix engine-spawn-leak concurrency tests that time out in the full suite

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-10-13 05:38

## Description

The six `concurrency limit already full` / `concurrency limit filled while spawning` cases in `test/engine-spawn-leak.test.ts` pass alone but time out (5s) when run after the other test files, on a clean tree too. Likely leftover processes or concurrency slots from earlier files.

Acceptance: the cases pass in the full `bun run test:api` run.

## ActiveForm

Fixing order-dependent spawn-leak tests.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Found while verifying `20261013-0244-worktree-cleanup-on-delete`.

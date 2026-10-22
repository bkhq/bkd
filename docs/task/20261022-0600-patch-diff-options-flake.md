# 20261022-0600-patch-diff-options-flake patch-diff-options fails intermittently in the full frontend suite

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-10-22 06:00

## Description

`src/__tests__/components/patch-diff-options.test.tsx` > "does not ask a partial diff to
expand unchanged lines" failed in full `vitest run` executions on 2026-10-15, 2026-10-21 and
2026-10-22 (once at ~1s, so not only a timeout) and passes when run alone and on reruns.
Find the cross-test interference or timing dependency and make it deterministic.

## ActiveForm

Fixing the patch-diff-options flake

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

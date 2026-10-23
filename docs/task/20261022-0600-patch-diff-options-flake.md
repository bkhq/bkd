# 20261022-0600-patch-diff-options-flake patch-diff-options fails intermittently in the full frontend suite

- **status**: completed
- **priority**: P3
- **owner**: main/issue-menu-20261015
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

## Resolution

Not a timing tolerance problem in the component. `findByTestId('file-diff')` (1 s default)
covered two costs: the first, lazy `import('@pierre/diffs')` that `ShikiPatchDiff` uses to
parse the patch (measured 300-500 ms cold, more on a loaded machine), and React 19's
Suspense reveal throttle (`FALLBACK_THROTTLE_MS = 300`) before `LazyFileDiff` replaces its
fallback. Together 700-950 ms, so the outcome tracked machine load (it failed every time
alone while the dev server was running). Parsing (< 10 ms) and the mocked
`@pierre/diffs/react` (0 ms) were not the cost; mocking `ShikiCodeBlock` changed nothing.

The test now imports `@pierre/diffs` in `beforeAll`, so its window covers only the render
(~400 ms, dominated by the fixed throttle). The assertions are unchanged. Verified 5/5 runs
alone and 3/3 full frontend runs with the dev server running.

- complete: Cold library import moved out of the timed window; root cause recorded

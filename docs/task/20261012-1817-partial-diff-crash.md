# 20261012-1817-partial-diff-crash Stop patch diffs from crashing the page

- **status**: completed
- **priority**: P1
- **owner**: roy/partial-diff-crash
- **createdAt**: 2026-10-12 18:17

## Description

Opening a tool call or a changed file whose diff comes from a patch throws
`FileDiff: loadDiffFiles is required to load full files for a partial diff`
and lands in the ErrorBoundary.

`@pierre/diffs` went from 1.2.12 to 1.5.2 in the dependency upgrade. A diff
parsed from a patch alone is partial; 1.5.2 treats `expandUnchanged: true` on
a partial change/rename diff as a request to load the full files and throws
without a `loadDiffFiles` callback. `ShikiPatchDiff` (`CodeRenderers.tsx`)
and `PatchDiffView` (`DiffPanel.tsx`) both pass `expandUnchanged: true`.

Acceptance:

- Neither patch renderer asks a partial diff to expand unchanged lines.
- A test renders `ShikiPatchDiff` with a real parsed patch and checks the options.

## ActiveForm

Fixing the patch diff crash

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Standard tier; the bug report is the request to fix.

- complete: patch-diff-options.test.tsx RED then GREEN; lint and typecheck pass; frontend 179/179. The test checks the options handed to the library, not a browser render.

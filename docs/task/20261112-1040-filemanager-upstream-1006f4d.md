# 20261112-1040-filemanager-upstream-1006f4d Update the vendored file manager to upstream 1006f4d

- **status**: completed
- **priority**: P2
- **owner**: claude/session-fm-1006f4d
- **createdAt**: 2026-11-12 10:40

## Description

`bkhq/filemanager` moved from `92bfee0` to `1006f4d` (compact workspace toolbar, navigating path bar). The local
`src/fm` trees are identical to `92bfee0`, so the update is a plain re-copy of the changed registry files:
`react/labels.ts`, `react/path-bar.tsx`, `react/shell-parts.tsx`, `react/use-listing-state.ts`,
`react/workspace-shell.tsx`. The API-side tree is unchanged upstream.

Acceptance: `src/fm` matches upstream `1006f4d`; `bun run check` passes; the file manager renders in the browser.

## ActiveForm

Updating the vendored file manager to upstream 1006f4d

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes


- complete: Re-copied five files; src/fm matches upstream 1006f4d. lint, typecheck, frontend tests and build pass; path bar steps and separator pickers checked in the browser on the Skills page.

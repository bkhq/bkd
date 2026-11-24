# 20261124-0840-filemanager-upstream-v1-1-0 Update the vendored file manager to upstream v1.1.0

- **status**: completed
- **priority**: P2
- **owner**: claude/session-fm-v1-1-0
- **createdAt**: 2026-11-24 08:40

## Description

`bkhq/filemanager` released v1.1.0 (`aa082c5`): a cleaner workspace header (search behind an icon, long paths
folded into a `…` menu, the folder toolbar folding into More below 760px), `SourcePreview` (editor plus a
rendered view, side by side or toggled) that the Markdown preview now builds on, and `FmPlugin.codeRenderers`.
The local `src/fm` trees are identical to v1.0.0, so the update is a plain re-copy of the changed registry files
plus the new `react/source-preview.tsx`. The API-side tree is unchanged upstream.

The new `fm-plugin-mermaid` (`plugins/mermaid.ts`, `plugins/mermaid-view.tsx`) is vendored too and enabled in
both hosts (`WorkspaceFiles`, `SkillFiles`); it adds the `mermaid@12.3.0` dependency, loaded lazily with the
first diagram.

Acceptance: `src/fm` matches upstream v1.1.0 for every vendored file; `bun run check` passes; the file manager
renders in the browser.

## ActiveForm

Updating the vendored file manager to upstream v1.1.0

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- complete: Re-copied 12 changed files and added `react/source-preview.tsx` and the mermaid plugin; src/fm matches
  upstream v1.1.0. lint, typecheck, tests (api 1058, frontend 434) and build pass; mermaid stays out of the entry
  and file-manager chunks. A `.mmd` file and a ```` ```mermaid ```` block in Markdown render as diagrams in the
  project file drawer. Checked on the Skills page in the browser: folder
  header, Markdown source / split view (`data-fm-rendered` present), narrow 700px layout; no page errors.

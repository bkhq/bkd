# 20261013-2004-tool-panel-lazy-render Stop rendering collapsed tool calls, keep Markdown for agent messages only

- **status**: completed
- **priority**: P1
- **owner**: roy/tool-panel-lazy-render
- **createdAt**: 2026-10-13 20:04

## Description

The chat feels slow on sessions with many tool calls. `ToolPanel`
(`CodeRenderers.tsx`) wraps its body in a native `<details>`, which hides the
body but still mounts it. Every tool call in the visible window (virtualizer
overscan 15, plus all rows below the 80-message virtualization threshold)
therefore runs its full body while collapsed: Shiki + DOMPurify for command and
search output, a `@pierre/diffs` diff for every Edit, and `MarkdownContent`
(streamdown, or the Shiki Markdown source view) for Agent results and subagent
text. `rebuildMessages` also recreates every `ToolGroupItem` on each stream
event, so `MemoizedToolItemRenderer` never bails out and the mounted bodies
re-render — and re-sanitize their HTML — on every delta.

Acceptance:

- A collapsed tool call mounts only its summary row; the body mounts on first open.
- Tool calls no longer use `MarkdownContent`; Agent results and subagent text
  render as plain pre-wrapped text. Markdown rendering stays on top-level agent messages.
- Opening a tool call shows the same content as before, minus Markdown formatting.

## ActiveForm

Rendering tool call bodies only when opened

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Standard tier: `CodeRenderers.tsx`, `ToolItems.tsx` and their test, one module.

- complete: tool-items.test.tsx RED then GREEN; frontend 197/197, lint and typecheck pass. Not measured in a browser.

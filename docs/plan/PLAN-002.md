# PLAN-002 Whiteboard UI overhaul — edges, collapse badges, markdown rendering

- **status**: implementing
- **createdAt**: 2026-04-15 17:00
- **approvedAt**: 2026-04-15 17:30
- **relatedTask**: WB-002

## Context

The whiteboard mindmap was implemented in three PRs (#112-#114) with functional CRUD, AI interaction, and issue generation. However the visual quality doesn't match the reference design (ponder.ing). Key gaps:

1. **Edges not rendering** — smoothstep edges are created in layout but xyflow doesn't draw them reliably with the current synchronous layout approach
2. **Collapse indicator** — hidden in hover-only toolbar; reference shows always-visible circle badge with child count on the node's right side
3. **Content is plain text** — reference renders full markdown (tables, lists, links, bold, code)
4. **Editing** — basic textarea; reference has a block editor toolbar (B/I/U/S/code/math/link)

### Existing infrastructure
- `MarkdownContent` (lightweight inline markdown) already exists in `components/issue-detail/`
- `MarkdownRenderer` (full, react-markdown + remarkGfm) exists in `components/files/`
- Layout is synchronous tree algorithm in `whiteboard-layout.ts`
- Custom node is `MindmapNode.tsx` with xyflow `Handle` components

## Proposal

### Step 1 — Fix edges with custom bezier edge + explicit handle positioning

**Problem**: xyflow's built-in edge types need handle positions computed from DOM measurements. Our synchronous layout sets positions before xyflow mounts, so handles have no measured offsets.

**Solution**: Use a custom edge component that calculates the bezier path from the known node positions + dimensions directly, bypassing xyflow's handle-based path calculation.

- Create `MindmapEdge.tsx` — custom edge that draws a curved bezier from source node's right center to target node's left center using the position data we already have
- Register it as `edgeTypes={{ mindmapEdge: MindmapEdge }}`
- Change edge type from `'smoothstep'` to `'mindmapEdge'` in layout
- Style: 1.5px stroke, muted-foreground color, rounded bezier curve

Files: `MindmapEdge.tsx` (new), `whiteboard-layout.ts` (edge type), `WhiteboardCanvas.tsx` (edgeTypes)

### Step 2 — Always-visible collapse badge with child count

**Problem**: Collapse toggle is buried in the hover toolbar.

**Solution**: Add a persistent badge on the right side of each node that has children, showing the child count and acting as the collapse toggle.

- Remove collapse button from the hover toolbar
- Add a circle badge positioned at the node's right edge (absolute, outside the card)
- Badge shows child count number + `>` chevron
- Click toggles collapse/expand
- Collapsed: solid badge with count; Expanded: outlined badge with count
- Always visible (not hover-dependent)

Files: `MindmapNode.tsx`

### Step 3 — Markdown content rendering (read-only)

**Problem**: Node content displays as plain text with `line-clamp-3`.

**Solution**: Use the existing `MarkdownContent` component to render node content.

- Import `MarkdownContent` from `components/issue-detail/MarkdownContent`
- Replace the plain `<p>` content display with `<MarkdownContent content={data.content} />`
- Remove the `line-clamp-3` restriction — let content expand naturally
- Remove `max-w-[320px]` from the node — use `w-[360px]` for wider cards that can show tables
- Keep the click-to-edit textarea as a fallback; future step can upgrade to rich editor

Files: `MindmapNode.tsx`, `whiteboard-layout.ts` (NODE_WIDTH constant)

### Step 4 — Layout constants and polish

- Increase `NODE_WIDTH` from 280 to 360 to accommodate markdown content
- Increase `H_GAP` from 60 to 80 for more breathing room
- Increase `V_GAP` from 20 to 24
- Ensure edges connect at the correct Y center for variable-height nodes

Files: `whiteboard-layout.ts`

## Risks

1. **Custom edge performance** — Drawing custom SVG paths for many edges could be slow with 100+ nodes. Mitigation: the paths are simple bezier curves, very cheap to compute.
2. **MarkdownContent in xyflow node** — React components inside xyflow nodes can cause re-render issues. Mitigation: MindmapNode is already `memo`'d; MarkdownContent is lightweight.
3. **Variable node height** — With markdown content, nodes have unpredictable heights. The layout algorithm uses `NODE_HEIGHT_BASE` for all nodes. Mitigation: Accept fixed-estimate height for layout; visual overlap is rare since most nodes have short content.

## Scope

4 steps, all frontend-only. No backend changes. Estimated ~200 lines changed.

## Alternatives

1. **Use xyflow's `BezierEdge`** — Built-in but requires measured handle positions; doesn't work with our synchronous layout.
2. **Use CSS lines instead of SVG edges** — Simpler but less flexible; can't curve around nodes.
3. **Use tiptap for rich editing now** — Too much scope; defer to a future task.

## Annotations

(User annotations and responses. Keep all history.)

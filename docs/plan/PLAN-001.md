# PLAN-001 Project whiteboard mindmap technical design

- **status**: implementing
- **createdAt**: 2026-04-14 15:00
- **approvedAt**: 2026-04-14 15:30
- **relatedTask**: WB-001

## Context

BKD is a kanban app for managing AI coding agents. The whiteboard feature adds a project-level AI-driven mindmap for project planning and architecture visualization. Each project gets one whiteboard. Requirements were discussed in detail with the user, including reference screenshots from a similar product (Heptabase-style AI mindmap).

### Existing patterns investigated

- **DB schema**: SQLite + Drizzle ORM, `shortId()` (nanoid 8-char) for entities, `id()` (ULID) for logs. All tables use `commonFields` (createdAt, updatedAt, isDeleted soft delete).
- **Backend routes**: Hono router with OpenAPI + Zod validation. Routes registered in `app.ts`. Schemas in `openapi/schemas.ts`, route defs in `openapi/routes.ts`.
- **Frontend**: React 19 + Vite 7 + TanStack Query v5 + Zustand stores. Lazy-loaded pages. API client in `kanban-api.ts`, hooks per feature domain.
- **Engine system**: Issues have engine sessions. Follow-up sends additional turns to the same session. `IssueEngine.followUpIssue()` is the entry point.

### Frontend library evaluation

| Library | Custom React nodes | Auto-layout | Expand/collapse | Drag rearrange | React 19 | Ecosystem |
|---|---|---|---|---|---|---|
| @markmap/view | No (SVG only) | Built-in | Built-in | No | Unverified | Small |
| **@xyflow/react** | **Full support** | **Via elkjs** | **Official example** | **Built-in** | **Official** | **4.3M/wk** |
| react-d3-tree | Limited (foreignObject) | Built-in | Built-in | No | Yes | 230K/wk |
| @minoru/react-dnd-treeview | Full support | None | Built-in | Built-in | Yes | 80K/wk |
| Custom D3 | Manual | Manual | Manual | Manual | N/A | N/A |

**Winner: @xyflow/react + elkjs** — only option that fully supports rich React card nodes + auto-layout + drag rearrange. Official mindmap tutorial available.

## Proposal

### 1. Database Schema

New table `whiteboard_nodes` — each node is one record:

```sql
CREATE TABLE whiteboard_nodes (
  id TEXT PRIMARY KEY,           -- shortId (nanoid 8-char)
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES whiteboard_nodes(id),
  label TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',  -- Markdown rich text
  icon TEXT DEFAULT '',              -- Emoji icon
  sort_order TEXT NOT NULL DEFAULT 'a0',
  is_collapsed INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,                     -- JSON: future extensibility (color, style, etc.)
  bound_issue_id TEXT REFERENCES issues(id),  -- AI conversation issue (typically on root node)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX whiteboard_nodes_project_id_idx ON whiteboard_nodes(project_id);
CREATE INDEX whiteboard_nodes_parent_id_idx ON whiteboard_nodes(parent_id);
```

Drizzle schema in `apps/api/src/db/schema.ts`:

```typescript
export const whiteboardNodes = sqliteTable(
  'whiteboard_nodes',
  {
    id: shortId(),
    projectId: text('project_id').notNull().references(() => projects.id),
    parentId: text('parent_id'),  // self-ref, app-level FK
    label: text('label').notNull().default(''),
    content: text('content').notNull().default(''),
    icon: text('icon').default(''),
    sortOrder: text('sort_order').notNull().default('a0'),
    isCollapsed: integer('is_collapsed', { mode: 'boolean' }).notNull().default(false),
    metadata: text('metadata'),  // JSON
    boundIssueId: text('bound_issue_id').references(() => issues.id),
    ...commonFields,
  },
  table => [
    index('whiteboard_nodes_project_id_idx').on(table.projectId),
    index('whiteboard_nodes_parent_id_idx').on(table.parentId),
  ],
)
```

Design decisions:
- **One record per node** — supports future block editor, granular updates, node-level metadata
- **`parentId` tree** — simple, sufficient for mindmap hierarchy
- **`sortOrder`** — fractional indexing (same pattern as issues) for sibling ordering
- **`boundIssueId`** — links the whiteboard's AI conversation issue; typically set on the root node
- **`metadata` JSON** — extensible for future node styling (color, width, etc.)
- No separate `whiteboards` table — the root node (parentId = null) represents the whiteboard itself

### 2. API Routes

All routes scoped under project:

```
GET    /api/projects/:projectId/whiteboard/nodes          — List all nodes (flat array, client builds tree)
POST   /api/projects/:projectId/whiteboard/nodes          — Create node
PATCH  /api/projects/:projectId/whiteboard/nodes/:id      — Update node
DELETE /api/projects/:projectId/whiteboard/nodes/:id      — Soft-delete node + descendants
PATCH  /api/projects/:projectId/whiteboard/nodes/bulk     — Bulk update (reorder, reparent after drag)
POST   /api/projects/:projectId/whiteboard/ask            — AI ask (follow-up on bound issue)
POST   /api/projects/:projectId/whiteboard/generate-issues — AI generate issues from selected nodes
```

Route file: `apps/api/src/routes/whiteboard.ts`

**GET /nodes** returns flat array — the frontend builds the tree and computes xyflow node/edge positions via elkjs layout.

**POST /ask** flow:
1. Find or create the bound issue (tag = `whiteboard`, visible on kanban)
2. Build prompt from: node path (root → target), node content, user question
3. Call `IssueEngine.followUpIssue()` with the constructed prompt
4. Parse AI response → optionally create/update child nodes
5. Return updated nodes + AI response

**POST /generate-issues** flow:
1. Receive selected node IDs
2. Build context from node subtrees
3. Call AI (via bound issue follow-up) to analyze and recommend structured issues
4. Return recommended issues for user confirmation
5. On confirmation, create issues via existing issue creation API

### 3. Shared Types

Add to `packages/shared/src/index.ts`:

```typescript
export interface WhiteboardNode {
  id: string
  projectId: string
  parentId: string | null
  label: string
  content: string
  icon: string
  sortOrder: string
  isCollapsed: boolean
  metadata: Record<string, unknown> | null
  boundIssueId: string | null
  createdAt: string
  updatedAt: string
}
```

### 4. Frontend Architecture

**New files:**

```
apps/frontend/src/
├── pages/WhiteboardPage.tsx              — Main page (lazy-loaded)
├── components/whiteboard/
│   ├── WhiteboardCanvas.tsx              — @xyflow/react ReactFlow wrapper
│   ├── MindmapNode.tsx                   — Custom node component (rich card)
│   ├── MindmapEdge.tsx                   — Custom edge (curved connecting line)
│   ├── NodeToolbar.tsx                   — Bottom toolbar (layout, copy, AI, outline, more)
│   ├── AskAIPopover.tsx                  — "Ask AI" popover (input, quick actions, questions)
│   ├── NodeEditor.tsx                    — Inline markdown editor
│   ├── GenerateIssuesDialog.tsx          — AI issue generation confirmation dialog
│   └── WhiteboardHeader.tsx              — Top bar (project name, bound issue link, actions)
├── hooks/use-whiteboard.ts               — React Query hooks + query keys
├── lib/whiteboard-layout.ts              — elkjs layout computation
```

**Route** in `main.tsx`:
```
/projects/:projectId/whiteboard → WhiteboardPage
```

**MindmapNode component** (the rich card):
- Header: emoji icon + label (editable)
- Body: markdown content preview (click to expand inline editor)
- Footer toolbar: layout toggle, copy, AI ask, outline, more menu
- Top-right badge: pending question count
- Styling via cn() + tailwind, consistent with existing shadcn/ui design

**Layout computation** (`whiteboard-layout.ts`):
- Takes flat node array → builds elkjs graph → computes positions → returns xyflow nodes + edges
- Tree direction: left-to-right (mindmap style)
- Recalculates on: node add/delete, drag-rearrange, expand/collapse

**Data flow:**
```
React Query (GET /nodes) → flat array → elkjs layout → xyflow nodes/edges → ReactFlow canvas
User action → mutation (POST/PATCH/DELETE) → invalidate query → re-layout → re-render
```

### 5. AI Interaction Design

**Bound issue:**
- Created automatically on first AI interaction (not on whiteboard creation)
- Tag: `whiteboard` — visible on kanban board
- Title: `[Whiteboard] {project name}`
- Users can view full conversation history in issue detail page

**"Ask AI" popover actions:**
- **Deep explore** — "Expand this topic into subtopics" → generates child nodes
- **Explain** — "Explain this concept" → adds explanation to node content
- **Simplify** — "Simplify this description" → rewrites node content
- **Examples** — "Give examples" → generates child nodes with examples
- **Free input** — user types custom question
- **Auto-generated questions** — AI occasionally suggests relevant questions (generated during AI responses, stored in node metadata)

**Prompt construction for follow-up:**
```
Context: Whiteboard for project "{projectName}"
Node path: Root > Parent > Current Node
Current node content: {content}
Action: {deep-explore|explain|simplify|examples|custom}
User question: {question}

Instructions: [action-specific instructions for output format]
```

### 6. Migration

New migration file: `apps/api/drizzle/NNNN_add_whiteboard_nodes.sql`

Single table creation with indexes. No data migration needed (new feature).

## Risks

1. **elkjs layout performance** — Large mindmaps (100+ nodes) may have layout calculation delay. Mitigation: use elkjs web worker, debounce layout recalculation, only re-layout affected subtree.
2. **AI response parsing** — AI output needs to be parsed into structured node data. Mitigation: use structured prompts with clear output format instructions; fallback to raw text if parsing fails.
3. **Concurrent editing** — Single user app, low risk. If needed later, node-level updates minimize conflicts.
4. **@xyflow/react bundle size** — ~1.2 MB unpacked. Acceptable since the page is lazy-loaded.

## Scope

### Phase 1 — Core mindmap (this plan)
- DB schema + migration
- API routes (CRUD + bulk)
- Frontend: canvas, node rendering, inline editing, drag rearrange, expand/collapse
- Auto-layout with elkjs

### Phase 2 — AI integration
- Bound issue creation
- Ask AI popover + quick actions
- Auto-generated questions
- AI response → node generation

### Phase 3 — Issue generation
- Node selection UI
- AI-powered issue recommendation
- Confirmation dialog + batch issue creation

## Alternatives

1. **markmap** — Simpler, markdown-native, but no custom React nodes. Would require SVG-only rendering, no toolbars/popovers on nodes. Rejected.
2. **react-d3-tree** — Good tree layout but no drag-to-rearrange and limited custom node support. Rejected.
3. **Single JSON blob storage** — Simpler than per-node rows, but blocks future block editor and makes granular updates impossible. Rejected.
4. **Separate `whiteboards` table** — One extra table for whiteboard metadata. Unnecessary since root node (parentId=null) serves as the whiteboard identity. Can be added later if needed.

## Annotations

(User annotations and responses. Keep all history.)

---
id: PLAN-024
title: Issue context menu and export
task: FEAT-004
status: completed
owner: claude
created: 2026-03-15
---

## Context

GitHub Issue #83 requests feature expansion for the kanban board. Based on screenshots:

1. **Screenshot 2**: A right-click context menu on issues with actions: Pin to Top, Rename, Copy, Download (Export chat as JSON / TXT), Delete.
2. **Screenshot 1**: Shows kanban board with status groups and issue counts.

### Current State

- **No context menu** exists anywhere for issues
- **No export/download** functionality for chat history
- **No pin/sticky** field on issues (notes have `isPinned`, issues do not)
- **Delete** already works via `useDeleteIssue` hook (soft delete)
- **Rename** can be done via existing `useUpdateIssue` hook
- **Copy/Duplicate** has no API endpoint
- **DropdownMenu** component from base-ui is fully available with submenu support
- Issue sorting uses `sortOrder` (fractional indexing) for drag-and-drop positioning
- Issue query orders by `statusUpdatedAt DESC`

## Proposal

### Step 1: Backend — Add `isPinned` field to issues

- New migration: add `is_pinned` integer column (default 0) to `issues` table
- Update Drizzle schema in `db/schema.ts`
- Update `serializeIssue` in `routes/issues/_shared.ts` to include `isPinned`
- Update shared `Issue` type in `packages/shared/src/index.ts`
- Update query sort: pinned issues first, then by `statusUpdatedAt DESC`

### Step 2: Backend — Add duplicate issue endpoint

- `POST /api/projects/:projectId/issues/:id/duplicate`
- Copies: title (prefix "Copy of "), tags, statusId → `todo`, parentIssueId, useWorktree
- Does NOT copy: session data, logs, attachments
- Returns the newly created issue

### Step 3: Backend — Add export logs endpoint

- `GET /api/projects/:projectId/issues/:id/export?format=json|txt`
- Requires project ownership validation
- `json` format: returns all logs as structured JSON array (all logs without pagination)
- `txt` format: returns plain text conversation (user messages and assistant replies formatted as readable text)
- Response as file download with `Content-Disposition` header

### Step 4: Frontend — Create `IssueContextMenu` component

- Shared component used by both `KanbanCard` and `IssueRow` (in IssueListPanel)
- Uses existing `DropdownMenu` primitives
- Triggered by right-click (`onContextMenu`) or a "..." button on hover
- Accepts a `showPin` prop to control pin item visibility
- Menu items:
  1. **Pin to Top / Unpin** — only shown when `showPin=true` (project/kanban route); hidden in review/detail route
  2. **Rename** — opens inline edit mode
  3. **Copy** — calls new duplicate API
  4. **Download** — submenu with:
     - Export chat history (.json)
     - TXT document (.txt)
  5. **Delete** — shows confirmation dialog, then calls `useDeleteIssue`

### Step 5: Frontend — Wire context menu into KanbanCard and IssueListPanel

- `KanbanCard.tsx`: context menu with `showPin=true`
- `IssueListPanel.tsx` (`IssueRow`):
  - In kanban/project route: `showPin=true`
  - In review/detail route: `showPin=false`
- Add "..." hover button to both components
- Add inline title editing state/UI

### Step 6: Frontend — Pin sorting in board store

- Update board-store or query sorting to show pinned issues at top of each status group
- Add visual indicator (pin icon) on pinned cards/rows

### Step 7: i18n

- Add all new strings to `en.json` and `zh.json`:
  - `contextMenu.pinToTop`, `contextMenu.unpin`, `contextMenu.rename`, `contextMenu.copy`, `contextMenu.download`, `contextMenu.exportJson`, `contextMenu.exportTxt`, `contextMenu.delete`, `contextMenu.deleteConfirm`, `contextMenu.copySuccess`

## Risks

- **Pin sorting vs drag-and-drop**: Pinned items at top may conflict with manual drag-and-drop reordering. Mitigation: pinned items always stay at top regardless of sortOrder; unpin to allow repositioning.
- **Export performance**: Large chat histories could be slow to export. Mitigation: stream the response for large datasets.
- **Context menu UX**: Right-click context menus are not discoverable on mobile/touch. Mitigation: also add a "..." kebab menu button visible on hover.

## Scope

**In scope:**
- Backend: migration, schema update, duplicate endpoint, export endpoint, query sort update
- Frontend: IssueContextMenu component (with showPin prop), inline rename, pin indicator, wire into KanbanCard + IssueRow
- i18n: zh + en keys

**Out of scope:**
- Project-level context menu (can be a follow-up)
- Bulk operations via context menu

## Alternatives

1. **Use existing sortOrder for pinning** instead of new column: fragile and conflicts with drag-and-drop. Separate boolean is cleaner.
2. **Modal dialog for rename** instead of inline editing: inline is more efficient and matches modern UX patterns.

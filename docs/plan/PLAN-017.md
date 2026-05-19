---
id: PLAN-017
title: Bulk ops + issue templates + done diff hover
status: completed
created: 2026-05-19
updated: 2026-05-19
tasks: [COCKPIT-003, COCKPIT-004, COCKPIT-005]
---

# PLAN-017 — Bulk ops + issue templates + done diff hover

## Context

The last three remaining pain points from the original audit:

- Bulk ops on issues (003)
- Issue templates (004)
- Diff hover (005)

All three are localized, low-coupling additions. Bundled in one plan
so we don't pay 3× the lint/test round-trip cost.

## Approach

### 003 — Bulk operations on review list

- `useBulkOperations` hook returns `{run, progress}` where `run`
  takes `{action, items}` and invokes the matching per-issue endpoint
  in parallel (limit concurrency to 5 to avoid overwhelming).
- `ReviewListPanel` exposes a `Set<string>` selection state via a new
  Zustand store (`use-bulk-selection-store.ts`) — keyed by issueId
  to survive re-renders + cross-group consistency.
- Each row gets a checkbox; project group headers get a "select all
  visible" tri-state checkbox.
- New `BulkOperationsBar` sticky at panel bottom; only renders when
  selection is non-empty.

### 004 — Issue templates

- Built-ins shipped in `apps/api/src/cockpit/templates.ts` (5 templates).
- User templates live under `appSettings.issueTemplates` (JSON
  string). Endpoint validates shape with zod.
- Frontend hook `useIssueTemplates()`; template select wired into
  `CreateIssueForm` and `CockpitQuickCreate`. Selecting a template
  prepends `promptPrefix` to the typed prompt + applies status/tags
  defaults.

### 005 — Diff hover on done cards

- `KanbanCard` checks `columnStatusId === 'done'` and wraps content
  in `Popover` (using existing `ui/popover.tsx`).
- Popover content lazy-fetches `useIssueChanges(projectId, issueId)`
  only when open (uses `useState(open)` + Query `enabled`).
- Mobile: card tap stays primary nav; long-press (≥400ms) opens
  popover via `onPointerDown` + `setTimeout`.

### TDD order

| # | Test | Implementation |
|---|------|----------------|
| 1 | `apps/api/test/api-issue-templates.test.ts` — built-ins + put/get round trip | templates.ts + route |
| 2 | `apps/frontend/.../BulkOperationsBar.test.tsx` — visible only when selection >0, action buttons | bar component |
| 3 | `apps/frontend/.../IssueTemplateSelect.test.tsx` — renders options, change fires onChange | template select |
| 4 | `apps/frontend/.../DoneDiffHover.test.tsx` — renders popover with file rows for done card | hover popover |

## Risks

- **Concurrent restart storms** — limit parallelism to 5 in
  `useBulkOperations`; backend has its own per-issue lock anyway.
- **Mobile long-press collision with card click** — guard the
  long-press timer; cancel if movement detected via `onPointerMove`.
- **Template JSON corruption** — schema-validate on PUT; on GET, drop
  any user-template row that fails validation, return remainder.

## Verification

- `cd apps/api && bun test test/api-issue-templates.test.ts`
- `cd apps/frontend && bunx vitest run src/__tests__/components/{BulkOperationsBar,IssueTemplateSelect,DoneDiffHover}.test.tsx`
- Lint: `bun run lint`
- Manual smoke desktop + mobile.

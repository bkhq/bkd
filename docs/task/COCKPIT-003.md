---
id: COCKPIT-003
title: Bulk operations on review list (multi-select + floating bar)
status: completed
priority: P1
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-017
---

# COCKPIT-003 — Bulk operations on review list

## Goal

Let the user multi-select issues across projects in the cockpit /
review list and act on them in one shot: bulk restart, bulk cancel,
bulk move to a different status.

## Scope

### Frontend
- `ReviewListPanel` row gains a checkbox (always visible on mobile,
  hover-revealed on desktop; ≥44px touch target on mobile).
- Group header gains "select all in this project" toggle.
- New `BulkOperationsBar` sticky at the bottom of the list panel when
  any issue is selected. Shows count + 3 actions:
  - Restart all
  - Cancel all
  - Move to (status dropdown)
- Cross-project bulk: operations group selections by projectId and
  invoke per-project endpoints concurrently.
- Hook: `use-bulk-operations.ts` wraps the loops and exposes per-id
  progress so the bar can show "3/10 restarted".

### Backend
- No new endpoints needed — reuses existing `cancel`, `restart`, and
  per-project `issues/bulk` PATCH.

## Out of scope
- Bulk delete (kept manual to avoid accidents).
- Per-card multi-select on kanban board view (drag-and-drop already
  there; selection there is a separate UX problem).

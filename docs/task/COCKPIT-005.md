---
id: COCKPIT-005
title: Diff hover preview on Done issue cards
status: completed
priority: P2
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-017
---

# COCKPIT-005 — Diff hover preview on done issue cards

## Goal

Answer "what did this AI run actually change?" at a glance without
opening the issue.

## Scope

### Frontend
- `KanbanCard` in the `done` column wraps its content in a
  `Popover` (hover-trigger on desktop, long-press / tap-to-toggle on
  mobile) that lazily loads `getIssueChanges` and renders a compact
  file list with `+N -M` line stats.
- Reuses `useIssueChanges` (existing hook); fetch happens only when
  the popover opens (not on hover-intent of every card).
- Empty / loading / error states each render their own affordance.

### Backend
- No changes — `/api/projects/:projectId/issues/:id/changes` already
  exists.

## Out of scope
- Full file-by-file diff rendering — that's the existing diff panel.
- Hover preview for non-done states.

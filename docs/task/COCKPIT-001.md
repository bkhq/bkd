---
id: COCKPIT-001
title: Global cockpit page skeleton — activity stream + project matrix + multi-status feed
status: completed
priority: P1
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-014
---

# COCKPIT-001 — Global cockpit page skeleton

## Goal

Upgrade the existing `/review` page into a single-screen cockpit that lets
the user observe and command all issues across all projects without
navigating away.

## Scope (this task)

- Extend `GET /api/issues/review` to accept `?statuses=` filter so the
  page can show `working+review` (cockpit default) or only `review`
  (legacy notifications consumer).
- New `GET /api/issues/stats` returning per-project status counts.
- Frontend cockpit dashboard rendered in the right pane when no issue
  is selected: project × status matrix + live activity stream.
- Status filter chips on the list panel header.
- ⌘N quick-create entry in the list header (reuses CreateIssueDialog).
- i18n keys for `cockpit.*` (en + zh).

## Out of scope (split into follow-up tasks)

- COCKPIT-002: Cross-project full-text log search (FTS5)
- COCKPIT-003: Bulk operations bar
- COCKPIT-004: Issue templates
- COCKPIT-005: Inline diff preview on hover
- Renaming `/review` route to `/cockpit`

## Verification

- `cd apps/api && bun test test/api-issues-review.test.ts test/api-issues-stats.test.ts`
- `cd apps/frontend && bunx vitest run src/__tests__/components/ProjectMatrix.test.tsx src/__tests__/components/ActivityStream.test.tsx`
- Manual: open `/review` with no issue selected, confirm matrix + activity stream render and update on SSE events.

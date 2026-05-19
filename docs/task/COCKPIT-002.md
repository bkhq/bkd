---
id: COCKPIT-002
title: Cross-project full-text log search (FTS5)
status: completed
priority: P2
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-016
---

# COCKPIT-002 — Cross-project full-text log search (FTS5)

## Goal

Replace the `LIKE`-based log search with SQLite FTS5 so users / the
cockpit assistant can do real ranked search across all conversation
history.

## Scope

### Backend
- Drizzle migration adds an FTS5 virtual table `issue_logs_fts`
  shadowing `issue_logs(content)` with `tokenize='porter unicode61'`.
- Triggers `AFTER INSERT / UPDATE / DELETE ON issue_logs` keep the
  shadow in sync.
- Upgrade `cockpit_search_logs` MCP tool to use FTS5 with `bm25()`
  ranking; fall back to LIKE if the FTS table is missing (defensive).
- New `GET /api/search/logs?q=&limit=` endpoint exposing the same
  capability to the frontend search page.

### Frontend
- `SearchContent` adds a "Logs" results section using the new endpoint
  (both desktop and mobile — single column on mobile, two columns on
  desktop with project/issue context).

## Out of scope
- Search across issue titles / metadata (already supported by existing
  search; this task focuses on conversation logs).

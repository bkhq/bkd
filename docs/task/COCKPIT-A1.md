---
id: COCKPIT-A1
title: Cockpit AI assistant (read-only) + mobile responsive cockpit
status: completed
priority: P1
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-015
---

# COCKPIT-A1 — Cockpit AI assistant (read-only) + mobile responsive cockpit

## Goal

Add an AI assistant to the cockpit that can answer questions about all
issues / projects across the BKD instance via in-process MCP tools.
Make the existing cockpit (COCKPIT-001) fully responsive: mobile must
be a first-class surface, not a follow-up.

## Scope

### Backend
- In-process SDK MCP server (`createSdkMcpServer`) registering five
  read-only cockpit tools:
  - `cockpit_get_stats`
  - `cockpit_list_issues({statuses?, projectId?, limit?})`
  - `cockpit_get_issue({issueId})`
  - `cockpit_recent_activity({limit?})`
  - `cockpit_search_logs({query, limit?})` (simple LIKE, FTS5 deferred to COCKPIT-002)
- `claude-sdk` executor: when `options.mcpServers` is provided in
  `SpawnOptions`, pass it through to the SDK `Options`.
- `IssueEngine.executeIssue` / `followUpIssue`: thread an optional
  `mcpServers` field through to the executor.
- New `POST /api/cockpit/ask` route:
  - Ensures `__cockpit__` archived project exists (singleton)
  - Ensures singleton hidden issue exists (id stored in
    `appSettings.cockpit:assistantIssueId`)
  - First turn: prepend cockpit system prompt, force engine
    `claude-code-sdk`, attach MCP server
  - Follow-up turns: forward to `followUpIssue` with the same MCP
    server attached
- New `GET /api/cockpit/assistant` returning the assistant issue id
  + project alias for the frontend to subscribe to its logs.

### Frontend (every change ships desktop + mobile)
- New `components/cockpit/AssistantFab.tsx` — floating action button,
  same component both surfaces.
- New `components/cockpit/AssistantPanel.tsx`:
  - Desktop (≥768px): right-side floating dock (380px width, overlays
    dashboard, ESC to close)
  - Mobile (<768px): bottom `sheet.tsx` covering 85% height
  - Both surfaces wrap `<ChatBody />` against the assistant issue
- `components/cockpit/ProjectMatrix.tsx` — add mobile card-stack
  layout (`md:` breakpoint switch)
- `components/cockpit/CockpitQuickCreate.tsx` — on mobile use
  `sheet.tsx side="bottom"` instead of popover
- `pages/ReviewPage.tsx` — mobile-only segmented control in list
  panel header: `[List] [Cockpit]`; selecting Cockpit replaces the
  list-panel body with `<CockpitDashboard />` full-width
- `hooks/use-cockpit-assistant.ts` — react-query hook fetching the
  assistant issue
- `lib/kanban-api.ts` — `getCockpitAssistant()`, `cockpitAsk()`
- i18n keys under `cockpit.assistant.*`

### Out of scope (split into follow-up tasks)
- Write tools (create/cancel/restart/bulk) — COCKPIT-A2 with
  confirmation gates
- Autonomous mode / scheduled cockpit checks — COCKPIT-A3
- FTS5 log search — COCKPIT-002

## Verification

- Backend:
  - `cd apps/api && bun test test/cockpit-tools.test.ts test/api-cockpit.test.ts`
- Frontend:
  - `cd apps/frontend && bunx vitest run src/__tests__/components/AssistantPanel.test.tsx src/__tests__/components/ProjectMatrix.mobile.test.tsx src/__tests__/components/CockpitQuickCreate.mobile.test.tsx`
- Lint: `bun run lint`
- Manual smoke (both surfaces):
  - 1280px viewport: matrix table, popover quick-create, dock assistant
  - 375px viewport: matrix cards, sheet quick-create, segmented control, bottom-sheet assistant

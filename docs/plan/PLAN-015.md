---
id: PLAN-015
title: Cockpit AI assistant (read-only MCP) + responsive cockpit
status: completed
created: 2026-05-19
updated: 2026-05-19
tasks: [COCKPIT-A1]
---

# PLAN-015 — Cockpit AI assistant (read-only MCP) + responsive cockpit

## Context

After COCKPIT-001 shipped the global dashboard, two gaps remained:

1. **No commander surface** — user has to manually navigate to act on
   issues. They want an AI delegate.
2. **Mobile second-class** — COCKPIT-001 components assume desktop
   (fixed grids, popovers, no mode switch).

Investigation findings:

- `@anthropic-ai/claude-agent-sdk` 0.2.114 ships `createSdkMcpServer`
  and `tool(name, desc, zodSchema, handler)` for **in-process** MCP
  tools — no stdio subprocess required.
- `claude-sdk/executor.ts:407-421` builds `sdkOptions` but never
  threads `mcpServers` through. Adding a single field passthrough is
  enough.
- `whiteboard.ts` is the proven precedent for "hidden issue singleton
  bound to an AI session" (`isHidden=true` + `executeIssue` first turn
  + `followUpIssue` subsequent).
- `projects.isArchived` already filters projects out of default
  `useProjects()` lists — an archived `__cockpit__` project is a
  clean host for the singleton issue.
- `apps/frontend/src/components/ui/sheet.tsx` is the shadcn primitive
  for mobile bottom sheets (used elsewhere in the codebase already).
- `useIsMobile()` at 768px breakpoint is canonical.
- `ChatBody.tsx:142` accepts an issue + handles SSE/scroll/input —
  reusable inside any container.

## Approach

### Layer 1 — Backend MCP foundation

1. `apps/api/src/mcp/cockpit-tools.ts` — pure-function tool handlers
   that take `{db, params}` and return `CallToolResult`. Trivially
   unit-testable without touching the SDK.
2. `apps/api/src/mcp/cockpit-server.ts` — `createCockpitMcpServer()`
   that wraps the handlers with `tool()` + `createSdkMcpServer`.

### Layer 2 — Engine plumbing

3. `engines/types.ts` — extend `SpawnOptions` (+ `FollowUpOptions`)
   with optional `mcpServers?: Record<string, McpServerConfig>`.
4. `engines/executors/claude-sdk/executor.ts` — pass
   `options.mcpServers` into `sdkOptions.mcpServers`.
5. `engines/issue/orchestration/execute.ts` &
   `engines/issue/orchestration/follow-up.ts` — forward `mcpServers`
   from caller to executor.

### Layer 3 — Cockpit assistant route

6. `apps/api/src/routes/cockpit/assistant.ts` —
   `POST /api/cockpit/ask` + `GET /api/cockpit/assistant`.
7. `apps/api/src/routes/cockpit/prompt.ts` —
   `buildCockpitSystemPrompt()` (read-only role, MCP tool guidance).
8. `apps/api/src/routes/cockpit/ensure-singleton.ts` —
   - get-or-create archived `__cockpit__` project
   - get-or-create hidden assistant issue (id in `appSettings`)
9. Mount in `routes/api.ts` at `/cockpit`.

### Layer 4 — Frontend assistant chat

10. `lib/kanban-api.ts` — `getCockpitAssistant()`, `cockpitAsk(prompt)`.
11. `hooks/use-cockpit-assistant.ts` — react-query hook for the
    assistant issue + a mutation wrapping `cockpitAsk`.
12. `components/cockpit/AssistantFab.tsx` — floating button (same
    component both surfaces).
13. `components/cockpit/AssistantPanel.tsx`:
    - `useIsMobile()` branches the wrapper:
      - desktop → `fixed right-4 top-16 bottom-4 w-[380px]`
      - mobile → shadcn `Sheet side="bottom"` 85vh
    - Inner content (header + ChatBody) identical for both surfaces.

### Layer 5 — Cockpit responsive polish

14. `components/cockpit/ProjectMatrix.tsx`:
    - desktop: existing grid table
    - `<md`: card-stack: each project a card with 4 status pills +
      total badge, 44px+ touch targets.
15. `components/cockpit/CockpitQuickCreate.tsx`:
    - `useIsMobile()` toggle: popover ↔ `<Sheet side="bottom">`
    - guard ⌘N listener with `!isMobile` for clarity (still harmless
      on mobile).
16. `pages/ReviewPage.tsx`:
    - new `cockpitMode: 'list' | 'cockpit'` state (mobile only)
    - render mobile segmented control inside list panel header (via
      a new prop on ReviewListPanel)
    - when mobile + `cockpitMode='cockpit'` and no issue selected,
      render CockpitDashboard inside the list-panel slot full-width.
17. `components/issue-detail/ReviewListPanel.tsx` — accept optional
    `mobileTab` + `onMobileTabChange` props; render segmented control
    when on mobile.

### TDD order

| # | Test | Implementation |
|---|------|----------------|
| 1 | `apps/api/test/cockpit-tools.test.ts` — tool handlers return correct shape + cover get_stats, list_issues, get_issue, recent_activity, search_logs | `mcp/cockpit-tools.ts` |
| 2 | `apps/api/test/api-cockpit.test.ts` — POST /ask creates singleton + returns issueId; GET /assistant returns it | `routes/cockpit/*` |
| 3 | `apps/frontend/src/__tests__/components/ProjectMatrix.mobile.test.tsx` — mobile renders card-stack instead of table | ProjectMatrix mobile branch |
| 4 | `apps/frontend/src/__tests__/components/AssistantPanel.test.tsx` — desktop renders dock; mobile renders sheet | AssistantPanel |
| 5 | `apps/frontend/src/__tests__/components/CockpitQuickCreate.mobile.test.tsx` — mobile uses Sheet, desktop uses popover | CockpitQuickCreate mobile branch |

Manual smoke for ReviewPage segmented control (resize devtools to
375px), since the integration spans navigation + media queries.

## Risks

- **MCP server mutation safety** — read-only this round (no write
  tools registered). Schema validation in `tool()` keeps args safe.
- **Singleton race on first request** — wrap ensure-singleton in
  a transaction (or compare-and-swap on `appSettings`).
- **Assistant issue accidentally surfacing** — already
  `isHidden=true`; verify `issues/query.ts` filters it out (the
  whiteboard precedent confirms this).
- **Mobile Sheet conflicting with existing drawers** — Sheet is
  z-50 by default; existing TerminalDrawer is z-40. Assistant
  Sheet should be the topmost when open.
- **claude-code-sdk not installed** — assistant detect → show
  install hint in panel, do not break the cockpit page.
- **Cockpit session context bloat** — out of scope this round
  (COCKPIT-A3 will add reset). Document in changelog as known.

## Verification

- Backend tests above
- Frontend tests above (5 new files, ≥15 cases)
- `bun run lint`
- Manual smoke at 1280px AND 375px viewports for: matrix layout,
  quick-create modal, assistant fab + panel open/close, segmented
  control toggle

---
id: PLAN-016
title: Cockpit write tools + FTS5 search + reset/suggested prompts
status: completed
created: 2026-05-19
updated: 2026-05-19
tasks: [COCKPIT-A2, COCKPIT-002, COCKPIT-A3]
---

# PLAN-016 — Cockpit write tools + FTS5 search + reset/suggested prompts

## Context

After COCKPIT-A1 shipped the read-only cockpit assistant, three gaps
remain:

1. The assistant can observe but cannot act ⇒ COCKPIT-A2 adds write
   tools gated by user approval.
2. `cockpit_search_logs` uses `LIKE`, which is slow + cannot rank
   ⇒ COCKPIT-002 adds SQLite FTS5.
3. The assistant session has no lifecycle controls and no onboarding
   prompts ⇒ COCKPIT-A3.

We deliver all three in one plan because they share the same surface
(AssistantPanel) and avoid double-touching files.

## Approach

### A2 — Write tools w/ approval gate

- `apps/api/src/cockpit/proposals.ts` — in-memory proposal store:
  `proposeAction()`, `listProposals()`, `approveProposal()`,
  `rejectProposal()`. Proposals carry `{id, type, params, summary,
  createdAt, status}`. TTL 30 min.
- `apps/api/src/mcp/cockpit-tools.ts` adds `cockpitProposeAction` —
  validates type + params, calls `proposeAction()`, returns id.
- `apps/api/src/routes/cockpit/proposals.ts` — REST endpoints:
  list / approve / reject; approve dispatches to the right internal
  helper:
  - cancel_issue → `issueEngine.cancelIssue`
  - restart_issue → `issueEngine.restartIssue`
  - bulk_update_status → DB transaction over the existing bulk update
    logic
  - create_issue → reuse the create-issue logic from `routes/issues/create.ts`
- SSE event `cockpit-proposal` emitted on new + resolved.
- Frontend: `hooks/use-cockpit-proposals.ts` + new
  `components/cockpit/CockpitProposalsBanner.tsx` (rendered inside
  `AssistantPanel` above the chat body). Approve/Reject buttons
  ≥44px on mobile.

### 002 — FTS5

- New migration `0014_cockpit_fts.sql` creates `issue_logs_fts`
  virtual table + insert/update/delete triggers.
- `cockpitSearchLogs` runs `SELECT ... FROM issue_logs_fts JOIN
  issue_logs ON ... WHERE issue_logs_fts MATCH ? ORDER BY bm25(...)`
  and falls back to LIKE if the table is absent.
- New `apps/api/src/routes/search.ts` exposing `GET /api/search/logs`.
- Frontend: `SearchContent.tsx` adds a "Logs" section calling the new
  endpoint; existing project/issue search untouched.

### A3 — Reset + suggested prompts

- `POST /api/cockpit/reset` in `routes/cockpit/assistant.ts` —
  soft-delete assistant issue, clear setting, emit SSE
  `cockpit-reset`.
- `AssistantPanel.tsx`:
  - Reset icon button in header (confirm via `alert-dialog`).
  - When assistant issue has no visible logs, render a
    `<SuggestedPrompts>` row inside the chat surface. Clicks dispatch
    `cockpitAsk(prompt)`.

### TDD order

| # | Test | Implementation |
|---|------|----------------|
| 1 | `apps/api/test/cockpit-proposals.test.ts` — propose / list / approve dispatch / reject / TTL | `cockpit/proposals.ts` + endpoints |
| 2 | `apps/api/test/cockpit-search-fts.test.ts` — multi-word ranked search; sync triggers | migration + tool upgrade |
| 3 | `apps/api/test/api-cockpit-reset.test.ts` — reset deletes the singleton; next /assistant creates fresh | reset endpoint |
| 4 | `apps/frontend/src/__tests__/components/CockpitProposalsBanner.test.tsx` — pending list renders; approve/reject mutate | banner component |
| 5 | `apps/frontend/src/__tests__/components/SuggestedPrompts.test.tsx` — renders 3 chips; click invokes onSelect | suggested prompts |

## Risks

- **Proposal TTL clearing inflight approval** — TTL is 30 min, approve
  endpoint checks not-expired.
- **FTS5 not available in older SQLite** — Bun's `bun:sqlite` ships
  recent SQLite; assume available, fall back to LIKE just in case.
- **Migration in production** — virtual tables + triggers are
  forward-only; rollback drops the FTS table (data still in
  `issue_logs`).
- **Approval bypass via direct API call** — the cockpit MCP tools
  cannot directly mutate; the proposal endpoints have no auth-level
  difference from regular routes (gated by the same auth middleware).

## Verification

- Backend: `cd apps/api && bun test test/cockpit-proposals.test.ts test/cockpit-search-fts.test.ts test/api-cockpit-reset.test.ts`
- Frontend: `cd apps/frontend && bunx vitest run src/__tests__/components/CockpitProposalsBanner.test.tsx src/__tests__/components/SuggestedPrompts.test.tsx`
- Lint: `bun run lint`
- Manual smoke 1280px + 375px: approve flow, reject flow, search-by-substring matches, reset clears session, suggested prompt sends as user message.

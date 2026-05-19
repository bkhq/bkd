---
id: COCKPIT-A2
title: Cockpit AI write tools with approval gate
status: completed
priority: P1
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-016
---

# COCKPIT-A2 — Cockpit AI write tools with approval gate

## Goal

Let the cockpit assistant request mutations (cancel/restart/create/bulk
status update) but require explicit user approval before execution.

## Scope

### Backend
- New MCP tool `cockpit_propose_action({type, summary, params})` —
  returns a proposalId. Does NOT execute. Stores in an in-process
  proposal store (lost on restart; appropriate for short-lived
  approvals).
- Supported action types this round:
  - `cancel_issue({issueId})`
  - `restart_issue({issueId})`
  - `bulk_update_status({issueIds[], statusId})`
  - `create_issue({projectId, title, statusId?})`
- New endpoints:
  - `GET /api/cockpit/proposals` — list pending
  - `POST /api/cockpit/proposals/:id/approve` — execute the underlying action
  - `POST /api/cockpit/proposals/:id/reject`
- SSE event `cockpit-proposal` (new + resolved) so the assistant panel can refresh without polling.

### Frontend
- `AssistantPanel` shows a pending-proposals banner above the chat
  (Approve / Reject buttons; mobile-friendly button sizing ≥44px).
- New hook `useCockpitProposals` + mutations.

## Out of scope
- Persistence across restarts (proposals are ephemeral by design)
- Delete (cannot be exposed without serious safeguards — UI manual)
- Project create/delete (out of cockpit purview)

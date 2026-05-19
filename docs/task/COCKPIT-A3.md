---
id: COCKPIT-A3
title: Cockpit assistant session reset + suggested prompts
status: completed
priority: P2
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-016
---

# COCKPIT-A3 — Cockpit assistant session reset + suggested prompts

## Goal

Avoid the cockpit assistant's context-window bloat over time and lower
the barrier to first use.

## Scope

### Backend
- `POST /api/cockpit/reset` — soft-deletes the singleton assistant
  issue and clears `appSettings.cockpit:assistantIssueId` so the next
  `/ask` creates a fresh session.

### Frontend
- Reset button in `AssistantPanel` header (icon + confirm).
- "Suggested prompts" chip row shown when the assistant has no
  conversation yet (or after reset). Three chips:
  - "What's stuck?"
  - "Show me failed sessions today"
  - "Summarize today's progress"
- Chips render in same component both surfaces; touch target 44px on
  mobile, compact on desktop.

## Out of scope
- Cron-driven autonomous mode — needs much more design (notification
  channels, error budget, escalation). Defer to a future task.

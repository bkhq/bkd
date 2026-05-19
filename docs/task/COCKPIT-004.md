---
id: COCKPIT-004
title: Issue templates in create dialog
status: completed
priority: P2
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-017
---

# COCKPIT-004 — Issue templates

## Goal

Stop re-typing the same "Fix bug in X" / "Add tests for Y" / "Refactor
Z" prompts. Provide built-in templates and a hook for users to define
their own.

## Scope

### Backend
- `apps/api/src/cockpit/templates.ts` — built-in template list (bug
  fix, refactor, add tests, investigation, follow-up review). Each
  template carries `{id, name, titlePattern, promptPrefix,
  defaultStatusId, defaultTags}`.
- User templates stored in `appSettings.issueTemplates` as JSON; merged
  with built-ins on read.
- Endpoints:
  - `GET /api/issue-templates` — list (built-in + user)
  - `PUT /api/issue-templates` — replace the user array (max 50)

### Frontend
- `CreateIssueForm` (and `CockpitQuickCreate`) gain a template
  dropdown at the top. Selecting a template fills title placeholder
  and prepends the prompt prefix to whatever the user types.
- Same dropdown both surfaces; mobile dropdown uses native select for
  reliability.

## Out of scope
- Full template-management settings page (PUT works, no UI yet).
- Per-project template overrides.

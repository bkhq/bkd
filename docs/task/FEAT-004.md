---
id: FEAT-004
title: Issue context menu and export
status: completed
priority: P1
owner: claude
plan: PLAN-024
created: 2026-03-15
---

## Description

Add a right-click context menu for issues on both KanbanCard and IssueListPanel, supporting:
pin to top, rename, copy/duplicate, download (export chat as JSON/TXT), and delete.

GitHub Issue: #83

## Acceptance Criteria

- [ ] Right-click on issue card/row shows context menu
- [ ] Pin to top works in project/kanban route; hidden in review/detail route
- [ ] Rename triggers inline title editing
- [ ] Copy duplicates the issue in the same project
- [ ] Download submenu exports chat history as JSON or TXT
- [ ] Delete soft-deletes the issue with confirmation
- [ ] All strings have i18n keys (zh + en)

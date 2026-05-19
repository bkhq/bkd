---
id: COCKPIT-006
title: Cockpit reachability upgrade (TopBar, RecentTabs, MiniMatrix, ⌘K spotlight, QuickCreate)
status: completed
priority: P1
owner: claude
created: 2026-05-19
updated: 2026-05-19
plan: PLAN-018
---

# COCKPIT-006 — Cockpit reachability upgrade

## Goal

Stop the user from "getting lost" when they enter an issue from the
cockpit dashboard. Make creation, switching, and overview reachable
from every cockpit state (empty / issue-selected / mobile).

## Scope

### Frontend (no backend changes)

1. **CockpitTopBar** — persistent 32px strip at the top of the
   cockpit chat column. Contains:
   - Breadcrumb: `🏠 / <projectAlias> ⚙️ / #N <title>`
   - Quick actions: `[+ New]`, `[⌘K]`, `[⊞ toggle]`
   - The `⚙️` opens the existing `ProjectSettingsDialog`
2. **RecentTabs** — strip under TopBar listing the 5 most recent
   issues from `use-recent-issues`. Each tab is `#N project ·
   title (truncated)` with a close × and click-to-jump. New issue +
   button at the end.
3. **MiniMatrix** — compact (project × status) card absolute-
   positioned at the right edge of the chat area when an issue is
   open. Reuses `useIssueStats`. Click a cell → navigate to that
   project filtered by status. Collapsible.
4. **SuggestedPrompts** — add a 5th suggestion line that nudges the
   user to ask the assistant for issue creation.
5. **CockpitQuickCreate upgrade**:
   - Replace `<select>` with the existing `Combobox` primitive
     (searchable project picker)
   - New "立刻执行 (working)" switch — when on, create directly in
     `working` status and trigger execution
6. **⌘K Spotlight upgrade** (in `SearchContent`):
   - `#<n>` query → fuzzy-match issueNumber across all projects
   - `⌘,` / "Project settings" quick action visible when the
     current cockpit URL contains a project context
   - Existing groups (running / review / logs / projects /
     quick actions) preserved

### Reactivity upgrade
- `useRecentIssues` currently reads once on mount. Migrate to a
  `useSyncExternalStore`-based subscription so writing via
  `addRecentIssue` triggers re-render in all consumers (TopBar tabs,
  ⌘K palette).

### Out of scope
- Backend changes
- Project page modifications
- Theme/colour work
- Drag-and-drop tab reordering (only close + click jump)

## Verification

- `cd apps/frontend && bunx vitest run`
- Manual smoke at 1280px + 375px:
  - Open `/review` empty → TopBar shows 🏠, no breadcrumb tail, no
    Recent tabs initially.
  - Click a review issue → TopBar updates with `<alias>/#N`,
    Recent tab appears, MiniMatrix shows on chat right edge.
  - Click MiniMatrix cell → navigates with status filter.
  - ⌘K → type `#123` → expects #123 in the issues group.
  - ⌘K → no input → "Project settings" appears under quick actions
    when on `/review/<alias>/...`.
  - Quick-create from TopBar → Combobox search + 立刻执行 toggle
    works.

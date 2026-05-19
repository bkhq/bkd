---
id: PLAN-018
title: Cockpit reachability upgrade
status: implementing
created: 2026-05-19
updated: 2026-05-19
tasks: [COCKPIT-006]
---

# PLAN-018 — Cockpit reachability upgrade

## Context

After PLAN-014..017, the cockpit can show / search / write tasks
across projects but suffers two repeat complaints:

1. **"迷路"** — entering an issue replaces the dashboard, leaving
   no breadcrumb / global overview / quick switcher.
2. **"创建任务麻烦"** — the QuickCreate popover is only on the
   empty dashboard, so once an issue is open the only path to a new
   issue is to back-navigate to the project.

Investigation confirms:
- `useRecentIssues` already records last 20 issues to localStorage
  via `addRecentIssue` (called from `ChatArea.tsx:56`).
- `GlobalCommandPalette` is a thin shell around `SearchContent` —
  the place to add `#N` parsing and contextual project settings.
- `ChatArea.tsx:207-284` is the existing title bar — a TopBar can
  sit as a sibling immediately above without disturbing it.
- `ProjectSettingsDialog` is reused by KanbanHeader + IssueListPanel
  so mounting it from a TopBar gear button is straightforward.
- `combobox.tsx` UI primitive exists for the QuickCreate project
  picker upgrade.

## Approach

### 1. Reactivity baseline
- `hooks/use-recent-issues.ts`: rewrite around `useSyncExternalStore`
  so any component reading `useRecentIssues()` updates immediately
  when `addRecentIssue` writes. Keep the existing API.

### 2. New components
- `components/cockpit/CockpitTopBar.tsx`:
  - Reads URL params to derive `projectAlias` / `issueNumber`.
  - Renders breadcrumb fragments with click-to-jump anchors.
  - Mounts `ProjectSettingsDialog` (lazy) for the gear button.
  - Action cluster on the right: `+ New` (opens QuickCreate),
    `⌘K` (opens GlobalCommandPalette), `⊞` (toggles MiniMatrix
    visibility via a new zustand flag).
- `components/cockpit/RecentTabs.tsx`:
  - `useRecentIssues()` then `.slice(0, 5)`.
  - Active tab determined by URL `issueId`.
  - Close × removes from store; `+` opens QuickCreate.
- `components/cockpit/MiniMatrix.tsx`:
  - Same data shape as `ProjectMatrix` but rendered as a 200×N card
    in the top-right of `ChatArea`.
  - `view-mode-store` gains `miniMatrixCollapsed: boolean` +
    `toggleMiniMatrix()` (localStorage-persisted).
  - On click of a status cell → `navigate(/projects/:alias?status=)`.

### 3. Integrations
- `pages/ReviewPage.tsx`: render `<CockpitTopBar />` and
  `<RecentTabs />` once above the existing `<ReviewListPanel>` /
  `<ChatArea>` / `<CockpitDashboard>` row.
- `components/issue-detail/ChatArea.tsx`: when `projectId` && `issueId`
  are present (i.e. inside a cockpit chat), render `<MiniMatrix />`
  absolute-positioned in the upper-right corner of the chat column
  (z-index above ChatBody, below modal).

### 4. Search upgrade
- `components/search/SearchContent.tsx`:
  - Detect `#\d+` prefix in `normalizedQuery` → cross-project
    issue lookup. Reuses existing `kanbanApi.getReviewIssues({})`
    cached results; if not loaded yet, falls back to FTS5 hit
    style.
  - Project context detection: when `useParams()` resolves a
    `projectAlias`, surface a quick action "Project settings" that
    opens `ProjectSettingsDialog` for that project.

### 5. QuickCreate upgrade
- `components/cockpit/CockpitQuickCreate.tsx`:
  - Replace project `<select>` with `<Combobox>` (searchable).
  - Add `Switch` for "立刻执行" → on submit, `statusId: 'working'`
    instead of `'todo'`. Existing backend auto-execute kicks in.
  - Move trigger ownership to TopBar; current FAB-only entry stays
    as a backup.

### 6. SuggestedPrompts addition
- Append: `"在 alpha 项目建个 bug-fix issue 修 …"` (en/zh).

### TDD plan

| # | Test | Implementation |
|---|------|----------------|
| 1 | `__tests__/hooks/use-recent-issues.test.tsx` — multiple consumers see updates after `addRecentIssue` | reactive store |
| 2 | `__tests__/components/CockpitTopBar.test.tsx` — breadcrumb segments render from URL; gear opens settings | TopBar |
| 3 | `__tests__/components/RecentTabs.test.tsx` — renders ≤5 tabs, close × pops from store, active state highlights URL match | RecentTabs |
| 4 | `__tests__/components/MiniMatrix.test.tsx` — desktop renders compact card; click cell navigates with `?status=` | MiniMatrix |
| 5 | `__tests__/components/SearchContent.hash.test.tsx` — `#12` query returns issue with issueNumber=12 | SearchContent upgrade |
| 6 | `__tests__/components/CockpitQuickCreate.upgrade.test.tsx` — Combobox renders + 立即执行 toggle posts working+execute | QuickCreate upgrade |

## Risks

- **Layout density**: TopBar (32px) + RecentTabs (32px) + existing
  title bar (45px) = 109px of chrome. Will compress chat. RecentTabs
  hidden when empty; TopBar can be collapsed via `⊞` toggle.
- **`useSyncExternalStore` SSR**: Vite + jsdom are fine; no SSR. Use
  empty-array initial snapshot.
- **`#N` cross-project ambiguity**: `#12` exists in N projects. Show
  all matches grouped by project, never auto-navigate.
- **MiniMatrix obscuring chat on narrow desktop**: collapse-by-
  default when `<1000px`. Mobile uses bottom-sheet variant (FAB).
- **Recent tabs cap = 5**: agreed locked default; revisit later.
- **Project settings dialog already mounted twice (KanbanHeader +
  IssueListPanel)**: TopBar gear becomes a third entry. All three
  pass the project prop in; no state collision.

## Verification

- `cd apps/frontend && bunx vitest run`
- `bun run lint`
- Manual smoke at 1280px + 375px (see task verification list)

## Out of scope (followups not in this plan)

- Drag-to-reorder recent tabs
- Per-project per-issue keyboard shortcut customization
- Theme tuning for breadcrumb / mini matrix
- Project page navigation changes
- Backend changes

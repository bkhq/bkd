# 20260922-1704-mobile-desktop-ui-parity Align mobile and desktop UI and finish the BKD rename

- **status**: completed
- **createdAt**: 2026-09-22 17:04
- **approvedAt**: 2026-09-22 17:05
- **relatedTask**: 20260922-1703-mobile-desktop-ui-parity

## Context

- Mobile is `useIsMobile()` (< 768px). Pages swap `AppSidebar` for a
  `MobileSidebar` trigger passed as `mobileNav` into the page header.
- Global entries live in four places with no shared definition:
  `components/kanban/AppSidebar.tsx` (bottom rail), `components/kanban/MobileSidebar.tsx`
  (sheet footer), `pages/HomePage.tsx` `MobileHomeMenu` and `DesktopHeaderControls`.
  `CronPage` and `LocalSessionsPage` are plain `<main>` layouts with a logo link home.
- `ui/dialog.tsx` base classes include `max-w-[calc(100%-2rem)] sm:max-w-sm`.
  `twMerge` only replaces same-variant conflicts, verified:
  `max-w-[calc(100%-2rem)] md:max-w-[580px]` -> `sm:max-w-sm max-w-[calc(100%-2rem)] md:max-w-[580px]`,
  `max-w-[600px]` -> `sm:max-w-sm max-w-[600px]` (384px wins at >= 640px).
  `ui/settings-layout.tsx` already implements the full-screen-below-md pattern
  but has the same latent `sm:max-w-sm` band.
- Brand: `MobileSidebar.tsx:70` "BitK"; `AppLogo.tsx:9` alt "BitK";
  `public/manifest.json` "Kanban"; `index.html` and `AppSettingsDialog.tsx:210`
  "BKD". Server name comes from `stores/server-store.ts` and already drives
  `document.title`.
- Tests: vitest + testing-library; `__tests__/components/app-sidebar.test.tsx`
  shows the mocking pattern for sidebar rendering.

## Proposal

1. Navigation
   - Add `components/global-pages.ts` exporting `GLOBAL_PAGES`:
     `[{ id: 'review', path: '/review', icon: Eye, labelKey: 'viewMode.review' }, { id: 'cron', ... }, { id: 'sessions', ... }]`.
   - Render it in `AppSidebar` (icon buttons before Settings), `MobileSidebar`
     (list rows before Settings), `MobileHomeMenu` and `DesktopHeaderControls`
     (replacing the hand-written Review / Cron / Sessions buttons).
   - `MobileSidebar` header: show the server name (fallback `BKD`) plus the
     SSE connection dot from `useEventConnection`.
   - `CronPage` and `LocalSessionsPage`: wrap in `flex h-full`, render
     `AppSidebar activeProjectId=""` on desktop and `MobileSidebar` trigger
     in the header on mobile, mirroring `ReviewPage`. `<main>` becomes a
     scrolling flex child.
2. Create-issue dialog
   - `DialogContent`: full-screen below `md` (same classes as `SettingsLayout`),
     `overflow-y-auto`, `max-w-none sm:max-w-none md:max-w-[580px]`.
   - Add `sm:max-w-none` to `SettingsLayout`.
   - `FilePreviewModal` `max-w-[600px]` -> `sm:max-w-[600px]`;
     `LocalSessionsPage` `max-w-lg` -> `sm:max-w-lg`;
     `DirectoryPicker` -> `sm:max-w-md`; `CreateProjectDialog` -> `sm:max-w-lg`.
   - Hint `issue.cmdEnterSubmit` gets `hidden md:inline`; textarea and tag
     input get `text-base md:text-sm`.
3. Touch targets and text
   - `IssueListPanel` / `ReviewListPanel` header buttons `h-9 w-9 md:h-7 md:w-7`;
     `KanbanHeader` icon buttons `p-2 md:p-1`.
   - Search inputs in both list panels and `KanbanHeader`, and title-edit
     inputs in `ChatArea` / `IssuePanel`: `text-base md:text-xs|sm`.
4. Branding
   - `AppLogo` alt `BKD`; `manifest.json` name / short_name `BKD`;
     package descriptions "BKD workspace"; `__BITK_*` -> `__BKD_*` in
     `scripts/package.ts`, `apps/api/src/root.ts`, `version.ts`, `globals.d.ts`;
     `worktree.test.ts` git user "BKD Test".
5. Tests (RED first)
   - `mobile-sidebar.test.tsx`: renders Review / Cron / Sessions entries and
     the `BKD` fallback / configured server name.
   - `app-sidebar.test.tsx`: renders Cron and Sessions entries.

## Risks

- `CronPage` / `LocalSessionsPage` change from `min-h-screen` document scroll
  to an inner scroll container; sticky or fixed elements inside are affected.
  Both pages are simple sections, checked before editing.
- Full-screen dialog uses `h-dvh`; iOS keyboard does not shrink `dvh`, but the
  content scrolls, matching `SettingsLayout` behaviour today.
- `__BITK_*` rename touches the release bundle defines; `scripts/package.ts`
  and the consumers change together, verified by `bun run typecheck` and the
  package script's own build.

## Scope

~20 files across `apps/frontend/src` (components, pages, tests, public assets),
`apps/api/src` (3 define consumers), `apps/api/test`, `scripts/package.ts`,
two `package.json` descriptions.

## Alternatives

- Change `ui/dialog.tsx` base to `md:max-w-sm`: fixes the band globally but
  widens every confirm dialog to ~735px on tablets. Rejected.
- A full nav-item abstraction including Terminal / Notes / Settings: those
  differ per surface (toggle vs fullscreen, dialog ownership), so the shared
  list covers only the routed pages.

## Annotations

- 2026-09-22: user replied "开始处理" after reviewing the findings and fix
  groups; treated as approval.

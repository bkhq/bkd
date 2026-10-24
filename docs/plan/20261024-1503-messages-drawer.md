# 20261024-1503-messages-drawer Show the messages inbox in a side drawer

- **status**: completed
- **createdAt**: 2026-10-24 15:03
- **approvedAt**: 2026-10-24 15:10
- **relatedTask**: 20261024-1503-messages-drawer

## Context

- `pages/MessagesPage.tsx` renders the inbox inside the page shell (`AppSidebar` / `MobileSidebar`), with group tabs, kind/campaign filters, cards and a close dialog.
- Global drawers (`TerminalDrawer`, `NotesDrawer`, ...) use `components/ui/side-panel.tsx` + a zustand store (`isOpen/isMinimized/isFullscreen/width`) and are lazy-mounted in `main.tsx`.
- `lib/global-pages.ts` lists `messages` as a routed page; it feeds `AppSidebar`, `MobileSidebar` and the `HomePage` menus (desktop header + mobile sheet). Sidebars show the waiting count badge on the messages entry.
- The backend webhook dispatcher links to `${serverUrl}/messages` (Telegram etc.), so the URL must keep working.
- Tests: `__tests__/pages/messages-page.test.tsx`, sidebar badge tests.

## Proposal

1. `stores/messages-store.ts`: copy of the terminal store shape (open/close/toggle/minimize/restore/openFullscreen/toggleFullscreen/setWidth, min width ~420, default 0.4, max 0.65).
2. `components/messages/MessagesDrawer.tsx`: `SidePanel` with `Inbox` icon + title, `SidePanelActions` (minimize, fullscreen, close). Body = the current inbox content moved out of the page into `components/messages/MessagesInbox.tsx` (tabs, filters, cards, close dialog), compacted for the drawer width.
3. `main.tsx`: lazy `MessagesDrawerMount`; replace the `/messages` route with a small component that opens the drawer and redirects to `/`; `/decisions` redirects to `/messages` as now. Delete `pages/MessagesPage.tsx`.
4. Remove `messages` from `GLOBAL_PAGES`; add a messages button next to the terminal/notes buttons in `AppSidebar`, `MobileSidebar` and `HomePage` (desktop + mobile), keeping the waiting-count badge (and the minimized dot).
5. i18n: add `messages.minimize` / `messages.maximize` / `messages.back` / `messages.close` keys if no reusable generic keys exist.
6. Tests: move the page test to the inbox component; update sidebar tests to assert the button opens the drawer and still shows the badge.

## Risks

- External `/messages` links now land on `/` with the drawer open instead of a dedicated page.
- The inbox layout at narrow drawer widths (filters row) needs wrapping.

## Scope

Frontend only, ~10 files: new store, drawer, inbox component; `main.tsx`, `global-pages.ts`, `AppSidebar`, `MobileSidebar`, `HomePage`, i18n `en/zh`, tests. Docs: CLAUDE.md route list, changelog.

## Alternatives

- Keep `/messages` as a page and also add the drawer: duplicate UI, rejected per request.
- `/messages` opens the drawer over the previous page instead of `/`: not possible on a direct link (no previous page); `/` is the sensible landing.

## Annotations

(none)

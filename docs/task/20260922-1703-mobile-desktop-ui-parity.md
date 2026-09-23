# 20260922-1703-mobile-desktop-ui-parity Align mobile and desktop UI and finish the BKD rename

- **status**: completed
- **priority**: P1
- **owner**: claude/session-main
- **createdAt**: 2026-09-22 17:03

## Description

A mobile/desktop audit of the frontend found four groups of inconsistencies,
plus leftover "BitK" branding.

1. Navigation. The four global menus expose different sets of entries:
   `AppSidebar` (desktop rail) has Review but not Cron / Local sessions;
   `MobileSidebar` has none of Review / Cron / Local sessions and no connection
   indicator; the home page menus (`MobileHomeMenu`, `DesktopHeaderControls`)
   have all three. On a phone, once inside a project, Review / Cron / Sessions
   are unreachable without going back to the home page. `/cron` and `/sessions`
   render no sidebar on desktop and no menu trigger on mobile.
2. Create-issue dialog. `DialogContent` is centered with no max-height or
   scroll, so on a phone with the keyboard open the footer is pushed off
   screen. Width overrides leave the base `sm:max-w-sm` in place
   (tailwind-merge does not drop it), so the dialog is 384px wide between
   640 and 767px; `FilePreviewModal` and the local-sessions import dialog are
   capped at 384px on desktop for the same reason and lose their mobile
   margin. The "Cmd+Enter" hint shows on touch devices; textarea and tag input
   use 14px text where `ChatInput` already uses `text-base md:text-sm`.
3. Touch targets and input text. Mobile drawer entries are 44-48px tall but
   the list-panel header buttons are 28px and the kanban header buttons ~22px;
   search and title-edit inputs use 12-14px text.
4. Branding. `MobileSidebar` hard-codes "BitK", `AppLogo` alt is "BitK",
   `manifest.json` is named "Kanban", while the document title, README and
   i18n say "BKD". Package descriptions and the bundle-time `__BITK_*`
   defines still carry the old name.

Acceptance criteria:

- Review, Cron and Local sessions are reachable from every global menu; the
  list is defined once and shared.
- `/cron` and `/sessions` show the desktop rail and the mobile menu trigger.
- The create-issue dialog is full-screen and scrollable below `md`, 580px
  centered above it, with no 384px band in between.
- No dialog override leaves the base `sm:max-w-sm` in effect unintentionally.
- Mobile header icon buttons are at least 36px; inputs use 16px text below `md`.
- No user-visible "BitK" / "Kanban" brand string remains; the mobile sidebar
  header shows the configured server name, falling back to "BKD".
- Regression tests cover the shared navigation entries and the brand fallback.

## ActiveForm

Aligning mobile and desktop UI and finishing the BKD rename

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Favicon glyph stays "BK"; three letters do not fit a 32px mark. Change on request.
- `pages/FileBrowserPage.tsx` is not routed (dead code); left untouched.
- Audit items U-06 / U-07 / U-08 in `docs/audit/frontend-quality-audit.md` remain open.
- Verification: `bun run lint` (2 pre-existing warnings), `bun run typecheck`,
  frontend vitest 127/127, `vite build`, `bun scripts/package.ts --skip-frontend`
  (bundle contains no `__BITK_`/`__BKD_` identifiers, defines inlined). API suite:
  728 pass, 1 pre-existing order-dependent failure reproduced on HEAD, tracked as
  20260922-1712-api-execution-suite-order-flake.
- `apps/api/src/engines/executors/claude/executor.ts` had an unrelated working-tree
  change (Opus 5.5 catalog entries) made by someone else during this session; not touched.

- complete: Focused tests, frontend suite, typecheck, lint, build and package script passed; API failure is pre-existing.

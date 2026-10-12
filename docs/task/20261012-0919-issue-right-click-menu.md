# 20261012-0919-issue-right-click-menu Right-click issue menu in the list, same menu in the chat header

- **status**: completed
- **priority**: P2
- **owner**: cd
- **createdAt**: 2026-10-12 09:19

## Description

The issue list rows only expose their actions (pin, rename, duplicate,
download, delete) through a hover-revealed "..." button; right-click does
nothing. The chat header has no actions at all apart from a standalone
"copy link" icon.

- Right-clicking a list row opens the same menu as its "..." button.
- The chat header gets the same "..." menu (pin, rename, duplicate,
  download, copy link, delete) and right-click on the title bar opens it too.
- The standalone "copy link" icon in the chat header is removed; "Copy link"
  becomes a menu item with a toast on success.

Implementation: the menu items and their dialogs move into a `useIssueMenu`
hook in `IssueContextMenu.tsx`, shared by the existing dropdown wrapper and a
new `IssueRightClickMenu` built on base-ui's `ContextMenu` (same menu
primitives, pointer-anchored).

Out of scope: the kanban card (drag-and-drop owns pointer events there) and
the kanban side panel header keep their current buttons.

Acceptance criteria:

- Right-click on a list row shows pin / rename / copy / download / delete.
- The chat header "..." and right-click show the same items plus "Copy link",
  which writes the issue URL to the clipboard.
- The header no longer renders the standalone link icon.
- i18n keys exist in `en.json` and `zh.json`.
- Focused vitest cases pass, then the frontend suite, lint, typecheck, build.

## ActiveForm

Adding right-click and header issue menus.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Requested by the user on 2026-10-12 with screenshots; to be committed
  together with the next change on `release`, then noted in #145.
- `dropdown-menu.tsx` now exports its popup class so the context-menu popup
  looks identical; base-ui's `ContextMenu` re-exports the same `Menu.Item`,
  so `DropdownMenuItem` works inside it unchanged.
- The right-click wrapper uses `className="contents"` so list rows and the
  title bar keep their layout.
- Follow-up (user report: header "..." did nothing): base-ui's
  `ContextMenu.Root` provides a Menu context, so a `Menu.Root` rendered under
  it is treated as that context menu's submenu and its trigger no longer
  opens on click. The "..." dropdowns now sit outside the right-click
  wrapper in both the list row (wrapper covers number / pin / title, title
  is `flex-1`) and the chat header (wrapper covers back button + title).
  `IssueRow` is exported for the regression test, which asserts the button
  is not inside `[data-slot="issue-context-trigger"]` and that both menus
  open.

- complete: focused tests, frontend suite, lint, typecheck and build passed
  (left uncommitted on purpose, to be committed with the next change).

## Verification

- `issue-context-menu.test.tsx`: 3 passed (row structure + both menus added later) (right-click on a row shows
  pin / rename / copy / download / delete without copy link; header "..."
  shows "Copy link" and writes the issue URL).
- Frontend suite: 27 files, 169 passed. `bun run lint` 0 errors (2
  pre-existing warnings), `bun run typecheck`, `bun run build` pass.

# 20261015-0610-workspace-toggle-fixed Keep the workspace panel toggle in one place

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-15 06:10

## Description

On desktop the workspace panel toggle lived in the chat header while the panel was
closed and in the panel's tab bar while it was open, so every click unmounted it in one
place and mounted it in another at a different offset (12px vs 8px from the edge) while
the panel slid in: the button visibly jumped ("flashes").

Acceptance criteria:

- One toggle, pinned to the top-right corner of the issue area above the panel, at the
  same position closed, opening, open, maximized and closed again.
- The inline panel no longer renders its own hide button; the fullscreen (mobile) panel
  keeps it, and the mobile chat header keeps its show button.

## ActiveForm

Pinning the workspace panel toggle

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

- complete: Toggle pinned top-right; same position in all states (browser-measured)

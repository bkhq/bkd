# CHAT-007 Mobile auto-load older history reliability fixes

- **status**: completed
- **priority**: P1
- **owner**: Claude
- **createdAt**: 2026-05-12 05:46
- **completedAt**: 2026-05-12 05:50

## Description

Two follow-up fixes to the auto-load older history feature
(commit `db360e7`) that surfaced after release on mobile:

1. **IntersectionObserver miss on inertial scroll** — iOS WebKit and
   some Android WebViews occasionally drop the intersection event
   during fast inertial scrolls, so the sentinel reports
   "not intersecting" even after the user has clearly scrolled to the
   top. Auto-load never fires.
2. **Loading spinner hidden behind title bar** — the mobile title bar
   is `position: absolute; z-20; ~52px tall` and overlays the top of
   the scroll container. Even when auto-load did fire, the spinner
   and the very first prepended message rendered behind the title
   bar, so the user saw no feedback ⇒ "doesn't load".

### Acceptance criteria

- Scrolling to the top on mobile reliably triggers `loadOlderLogs`
  (both via IntersectionObserver and a scroll-based fallback).
- The loading spinner appears below the title bar, visible to the
  user.
- No duplicate loads (shared guard between observer + scroll path).
- Desktop behavior unchanged.

## ActiveForm

Patching mobile auto-load reliability.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Shipped in two commits:

- `287c724 fix(chat): scroll-based fallback for auto-load older history on mobile`
  Added a scroll listener (`scrollTop ≤ 300`) alongside the existing
  `IntersectionObserver`. Both paths share the `hasOlderLogsRef` /
  `isLoadingOlderRef` guard so they cannot fire concurrently. Applied
  to both `SessionMessages.tsx` (legacy + virtualized branches) and
  `AcpTimeline.tsx`.

- `846aaaf fix(chat): keep mobile auto-load spinner out from behind the title bar`
  Added `max-md:pt-[60px]` to the messages flex container in
  `ChatBody.tsx`. 60px = 52px title height + 8px breathing room.

No new tests — these are layout / event-wiring fixes that the
existing chat-stream test suite already exercises end-to-end.

# CHAT-006 Mermaid diagram zoom viewer

- **status**: completed
- **priority**: P2
- **owner**: Claude
- **createdAt**: 2026-05-12 02:55
- **completedAt**: 2026-05-12 03:10

## Description

Chat-rendered mermaid diagrams are often too small to read once the
graph has more than a handful of nodes. Users had no way to zoom in
without manually inspecting the SVG in devtools.

Added a fullscreen lightbox viewer that opens from the inline diagram
via a corner button or whole-area click. The viewer hosts the same SVG
the chat already produced (no re-render) and provides:

- Wheel zoom and `+` / `-` / `0` keyboard shortcuts (0.25x–8x range)
- Click-drag pan with pointer capture
- Toolbar: zoom in / out / reset / close
- `Esc` to close; previously-focused element is restored on exit
- Trackpad pinch on laptops works for free (browsers map it to
  `wheel + ctrlKey`); native touch pinch was scoped out

### Acceptance criteria

- Inline diagram unchanged in size / theming.
- Corner `Maximize2` button appears on hover.
- Click anywhere on the diagram (cursor: zoom-in) opens the viewer.
- Wheel and toolbar buttons zoom from 0.25x to 8x; reset returns to 1x.
- Mouse drag pans the SVG without resizing it.
- `Esc` closes and restores focus to the element that opened the viewer.
- No new third-party dependencies.

## ActiveForm

Adding mermaid zoom lightbox.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Shipped in commit `32c86e8 feat(chat): zoom viewer for mermaid diagrams`.
Tracked retroactively — the work was small enough (single component
extension, no API / store changes, zero new deps) that the formal
investigate → proposal cycle was skipped in agreement with the user.

See PLAN-013 for the implementation sketch and a list of deliberate
non-goals (rubber-band drag-zoom, native mobile pinch, share-as-image).

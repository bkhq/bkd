# PLAN-013 Mermaid diagram zoom viewer

- **status**: completed
- **createdAt**: 2026-05-12 02:55
- **approvedAt**: 2026-05-12 02:55
- **completedAt**: 2026-05-12 03:10
- **relatedTask**: CHAT-006

## Context

`apps/frontend/src/components/MermaidDiagram.tsx` already renders the
mermaid SVG into a centred `flex` container with `overflow-x-auto`. The
SVG inherits mermaid's own sizing, which means dense graphs render at
sub-readable scale inside chat bubbles. There was no zoom affordance
and no way to inspect a small region.

Existing infra reused:

- `useTheme` for light/dark consistency (the cached SVG already matches
  the active theme; the viewer just re-projects it).
- `lucide-react` icons (`Maximize2`, `Plus`, `Minus`, `RefreshCw`, `X`).
- The shared `common.*` i18n namespace.
- Native pointer events for capture + drag; no @use-gesture or
  panzoom-style dependency required.

## Proposal

Added a sibling `MermaidZoomViewer` component inside
`MermaidDiagram.tsx`:

- Wraps the previously inline diagram block with:
  - A corner `Maximize2` button (hover-revealed, focus-visible) that
    sets local `zoomOpen` state.
  - A `role="button" tabIndex={0}` on the diagram body so whole-area
    click and keyboard activation both trigger the viewer.
- When `zoomOpen`, renders the lightbox as a fixed `z-[60]` overlay:
  - Top toolbar (zoom out / current % / zoom in / reset / close).
  - Viewport with `onWheel`, `onPointerDown/Move/Up` handlers.
  - SVG sits inside a transformed wrapper:
    `translate(-50%, -50%) translate(offset) scale(scale)`.
  - Esc / `+` / `-` / `0` keys via window-level keydown registered in
    `useEffect`; previously-focused element is restored on close.
- Constants `ZOOM_MIN = 0.25`, `ZOOM_MAX = 8`, `ZOOM_STEP = 1.25`.
- `clamp()` helper to keep wheel + button zoom within range.

i18n keys added under `common.*`:
`close`, `zoomIn`, `zoomOut`, `resetZoom`, `enlarge`.

## Risks

| Risk | Severity | Status |
|---|---|---|
| Trapped focus when the viewer mounts and the user is mid-typing in chat | Low | Mitigated — listener restores `prevFocus` on unmount |
| Wheel handler steals page scroll while the cursor is over the viewport | Low | Intended; viewer is full-screen so there is no outer scroll context to surrender |
| SVG `transform-origin` jumps when scale changes mid-drag | Low | Resolved — drag updates `offset` instead of transform-origin |
| Heavy SVGs cause jank on transform | Low | Reused the cached SVG; transforms are GPU-composited |
| Esc collides with the FileBrowserDrawer's own Esc handler (FILE-002) | Low | Mermaid viewer is a deeper modal — both handlers are window-level but the viewer always closes first because it is mounted later |

## Scope

Single file: `apps/frontend/src/components/MermaidDiagram.tsx`
(216 insertions, 7 deletions).

Plus i18n additions in `apps/frontend/src/i18n/en.json` + `zh.json`.

No backend, no store, no new dependencies, no new tests.

## Alternatives

### A. Use the existing `Dialog` primitive

Rejected. The `Dialog` (Base UI) component opinionates on width, padding,
and close button. A diagram zoom viewer wants the full viewport for
panning, which made a custom overlay cheaper.

### B. Add a `panzoom` / `svg-pan-zoom` dependency

Rejected. Both libraries are 5–15 KB and well-tested, but the manual
implementation is ~120 lines, comparable to integrating + theming the
library. Keeping the dependency surface lean was preferred.

### C. Rubber-band drag-zoom on the diagram

Out of scope. User confirmed wheel + drag-pan + buttons is enough.

### D. Native touch pinch (multi-touch)

Out of scope. Trackpad pinch already works via the browser's
`wheel + ctrlKey` mapping. Mobile pinch would require a touch handler
and is scheduled for follow-up if requested.

## Annotations

Retroactive record. Shipped as commit `32c86e8 feat(chat): zoom viewer
for mermaid diagrams` ahead of formal proposal review per user
agreement that the change was scope-bounded.

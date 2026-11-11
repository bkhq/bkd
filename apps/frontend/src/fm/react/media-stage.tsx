import type { HTMLAttributes, PointerEvent as ReactPointerEvent } from "react";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { FmLabels } from "./labels";
import type { FmMediaView, FmPanZoom, FmSize } from "./transform";
import { cn } from "cn";
import { FlipHorizontal2Icon, RotateCwIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MiniMap, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { Button } from "@/components/ui/button";
import { IconButton } from "./icon-button";
import { centerOn, clampPan, INITIAL_VIEW, layoutOf, maxZoomOf, rotateBy, wheelFactor, zoomAround } from "./transform";

const PAD = 16;
/** Zoom in / out buttons and keys multiply or divide by this. */
const ZOOM_FACTOR = 1.5;
/** One curve for every zoom: buttons, keys, the percentage, double-click. */
const ZOOM_MS = 280;
const ZOOM_EASING = "easeOutCubic";
/** Below this stage width the pixel size and the minimap are left out. */
const WIDE_STAGE = 480;
/** Longer side of the minimap in pixels. */
const MINIMAP = 160;

/** Checkerboard behind the image box, so transparent pixels read as transparent. */
const CHECKERBOARD = {
  backgroundColor: "var(--background)",
  backgroundImage: [
    "linear-gradient(45deg, var(--muted) 25%, transparent 25%)",
    "linear-gradient(-45deg, var(--muted) 25%, transparent 25%)",
    "linear-gradient(45deg, transparent 75%, var(--muted) 75%)",
    "linear-gradient(-45deg, transparent 75%, var(--muted) 75%)",
  ].join(", "),
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};
const IMAGE_BOX_PROPS = { "data-fm-image-box": "" } as HTMLAttributes<HTMLDivElement>;

/** Inner size of an element (minus the stage padding), tracked with ResizeObserver. */
function useStageSize() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<FmSize>();
  useEffect(() => {
    if (!el)
      return;
    const ro = new ResizeObserver(([e]) => setSize({
      width: Math.max(1, e!.contentRect.width),
      height: Math.max(1, e!.contentRect.height),
    }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

/** Image or video with rotate / flip (and zoom for images); tools go into the preview header. */
export function MediaStage({ kind, src, alt, labels, actions }: {
  kind: "image" | "video";
  src: string;
  alt: string;
  labels: FmLabels;
  actions?: HTMLElement | null | undefined;
}) {
  const [view, setView] = useState<FmMediaView>(INITIAL_VIEW);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  // Only crossing fit re-renders; the percentage is written directly so zooming stays off React.
  const [zoomed, setZoomed] = useState(false);
  const percentRef = useRef<HTMLSpanElement>(null);
  const panZoomRef = useRef<FmPanZoom>({ scale: 1, positionX: 0, positionY: 0 });
  const [natural, setNatural] = useState<FmSize>();
  const [stageRef, stage] = useStageSize();
  const layout = natural && stage && layoutOf(natural, stage, view);
  const isImage = kind === "image";
  const maxZoom = layout
    ? maxZoomOf(layout.fit)
    : 4;
  // Steps by a factor around the middle of the view, so large images get there in a few clicks.
  const zoomBy = (factor: number) => {
    const t = transformRef.current;
    const wrapper = t?.instance.wrapperComponent;
    if (!t || !wrapper)
      return;
    const viewport = { width: wrapper.clientWidth, height: wrapper.clientHeight };
    const zoomedTo = zoomAround(panZoomRef.current, factor, { x: viewport.width / 2, y: viewport.height / 2 }, maxZoom);
    const next = layout
      ? clampPan(zoomedTo, layout, viewport)
      : zoomedTo;
    if (next.scale <= 1)
      void t.resetTransform(ZOOM_MS, ZOOM_EASING);
    else
      void t.setTransform(next.positionX, next.positionY, next.scale, ZOOM_MS, ZOOM_EASING);
  };
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  // Image keys: + / - zoom, 0 fit, R / Shift+R rotate, F flip. Active while focus is in the
  // preview's dialog or pane (not the tree, not text fields).
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const scale = layout?.fit;
  useEffect(() => {
    if (!isImage || !root)
      return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const scope = root.closest("[role=dialog], section") ?? root;
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !scope.contains(target)
        || target.closest("input, textarea, select, [contenteditable=true], [role=menu]")) {
        return;
      }
      const key = e.key.toLowerCase();
      if ((key === "+" || key === "=") && scale) {
        zoomByRef.current(ZOOM_FACTOR);
      }
      else if (key === "-" && scale) {
        zoomByRef.current(1 / ZOOM_FACTOR);
      }
      else if (key === "0") {
        transformRef.current?.resetTransform(ZOOM_MS, ZOOM_EASING);
      }
      else if (key === "r") {
        setView(v => rotateBy(v, e.shiftKey
          ? -90
          : 90));
      }
      else if (key === "f") {
        setView(v => ({ ...v, flip: !v.flip }));
      }
      else {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isImage, root, scale]);
  // Wheel and trackpad zoom around the pointer by a fixed factor per notch.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e) => {
    const t = transformRef.current;
    const wrapper = t?.instance.wrapperComponent;
    if (!t || !wrapper || !layout)
      return;
    e.preventDefault();
    const box = wrapper.getBoundingClientRect();
    const viewport = { width: wrapper.clientWidth, height: wrapper.clientHeight };
    const at = { x: e.clientX - box.left, y: e.clientY - box.top };
    const next = clampPan(zoomAround(panZoomRef.current, wheelFactor(e.deltaY, e.deltaMode, viewport.height), at, maxZoom), layout, viewport);
    void t.setTransform(next.positionX, next.positionY, next.scale, 0);
  };
  useEffect(() => {
    if (!isImage || !root)
      return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [isImage, root]);
  const style = layout && natural
    ? {
        position: "absolute" as const,
        left: "50%",
        top: "50%",
        width: natural.width * layout.fit,
        height: natural.height * layout.fit,
        maxWidth: "none",
        transform: `translate(-50%, -50%) rotate(${view.rotate}deg) scaleX(${view.flip
          ? -1
          : 1})`,
      }
    : { maxWidth: "100%", maxHeight: "100%" };
  const box = layout
    ? { width: layout.width, height: layout.height }
    : undefined;
  // `scale` is relative to the fitted image: 1 is fit, 1 / fit is the real size.
  const percent = (scale: number) => `${Math.round((layout?.fit ?? 1) * scale * 100)}%`;
  const wide = !!stage && stage.width >= WIDE_STAGE;
  const pixels = natural && `${natural.width} × ${natural.height}`;
  // The percentage toggles between fit and the real size.
  const toggleRealSize = () => {
    if (zoomed || !layout || layout.fit >= 1)
      transformRef.current?.resetTransform(ZOOM_MS, ZOOM_EASING);
    else
      transformRef.current?.centerView(1 / layout.fit, ZOOM_MS, ZOOM_EASING);
  };

  // The library's minimap dragging assumes content as large as the viewport, so it is done here.
  const moveToMinimapPoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = transformRef.current;
    const wrapper = t?.instance.wrapperComponent;
    if (!t || !wrapper || !layout)
      return;
    const map = e.currentTarget.getBoundingClientRect();
    const next = centerOn(
      { x: (e.clientX - map.left) / map.width, y: (e.clientY - map.top) / map.height },
      panZoomRef.current.scale,
      layout,
      { width: wrapper.clientWidth, height: wrapper.clientHeight },
    );
    void t.setTransform(next.positionX, next.positionY, next.scale, 0);
  };

  const tools = (
    <>
      {isImage && pixels && wide && <span className="px-1 text-xs text-muted-foreground tabular-nums">{pixels}</span>}
      {isImage && layout && (
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          <IconButton label={labels.zoomOut} onClick={() => zoomBy(1 / ZOOM_FACTOR)}><ZoomOutIcon /></IconButton>
          <Button
            size="sm"
            variant="ghost"
            className="w-14 tabular-nums"
            title={`${zoomed || layout.fit >= 1
              ? labels.fitToScreen
              : labels.actualSize} · ${pixels}`}
            onClick={toggleRealSize}
          >
            <span ref={percentRef}>{percent(panZoomRef.current.scale)}</span>
          </Button>
          <IconButton label={labels.zoomIn} onClick={() => zoomBy(ZOOM_FACTOR)}><ZoomInIcon /></IconButton>
        </div>
      )}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        <IconButton label={labels.rotateRight} onClick={() => setView(v => rotateBy(v, 90))}><RotateCwIcon /></IconButton>
        <IconButton label={labels.flip} aria-pressed={view.flip} onClick={() => setView(v => ({ ...v, flip: !v.flip }))}><FlipHorizontal2Icon /></IconButton>
      </div>
    </>
  );

  return (
    <div ref={setRoot} className={cn("flex h-full overflow-hidden", isImage ? "bg-muted/30" : "bg-black/90")} style={{ padding: PAD }}>
      {actions && createPortal(tools, actions)}
      <div ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {isImage
          ? (
              // The viewport is the whole stage; the content is the fitted (rotated) image box.
              // A rotation or the first layout starts a fresh, centred view.
              <TransformWrapper
                key={`${view.rotate}:${layout ? "laid-out" : "loading"}`}
                ref={transformRef}
                centerOnInit
                // The wheel is handled in the effect below: a fixed factor per notch around the pointer.
                wheel={{ disabled: true }}
                panning={{ velocityDisabled: false, allowLeftClickPan: true }}
                trackPadPanning={{ velocityDisabled: false }}
                keyboard={{
                  disabled: false,
                  panStep: 48,
                  zoomStep: 0.25,
                  animationTime: 180,
                  animationType: "easeOut",
                }}
                doubleClick={{
                  mode: "toggle",
                  step: 0.5,
                  animationTime: ZOOM_MS,
                  animationType: ZOOM_EASING,
                }}
                pinch={{ step: 5, allowPanning: true }}
                zoomAnimation={{ animationTime: ZOOM_MS, animationType: ZOOM_EASING }}
                autoAlignment={{ animationTime: 180, velocityAlignmentTime: 220 }}
                minScale={1}
                maxScale={maxZoom}
                limitToBounds
                centerZoomedOut
                onTransform={(_, state) => {
                  panZoomRef.current = state;
                  setZoomed(state.scale > 1.001);
                  if (percentRef.current)
                    percentRef.current.textContent = percent(state.scale);
                }}
              >
                <TransformComponent
                  wrapperStyle={{ width: "100%", height: "100%" }}
                  contentStyle={{
                    ...box,
                    position: "relative",
                    ...CHECKERBOARD,
                  }}
                  contentProps={IMAGE_BOX_PROPS}
                >
                  <img
                    src={src}
                    alt={alt}
                    draggable={false}
                    style={style}
                    className={zoomed
                      ? "cursor-grab active:cursor-grabbing"
                      : "cursor-zoom-in"}
                    onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                  />
                </TransformComponent>
                {zoomed && wide && box && (
                  // Where the view is on the whole image; drag or click in it to move there.
                  <div
                    data-fm-minimap=""
                    aria-hidden
                    className="absolute right-3 bottom-3 z-10 cursor-pointer touch-none overflow-hidden rounded-md border bg-background/90 shadow-md"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      moveToMinimapPoint(e);
                    }}
                    onPointerMove={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        moveToMinimapPoint(e);
                    }}
                  >
                    <MiniMap
                      panning={false}
                      borderColor="var(--primary)"
                      {...(box.width >= box.height
                        ? { width: MINIMAP }
                        : { height: MINIMAP })}
                    >
                      <div style={{ ...box, position: "relative" }}>
                        <img src={src} alt="" decoding="async" draggable={false} style={style} />
                      </div>
                    </MiniMap>
                  </div>
                )}
              </TransformWrapper>
            )
          : (
              <div className="relative m-auto shrink-0" style={box}>
                <video
                  src={src}
                  controls
                  style={style}
                  onLoadedMetadata={e => setNatural({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
                />
              </div>
            )}
      </div>
    </div>
  );
}

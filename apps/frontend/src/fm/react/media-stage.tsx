import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { FmLabels } from "./labels";
import type { FmMediaView, FmSize } from "./transform";
import { cn } from "cn";
import { FlipHorizontal2Icon, RotateCcwIcon, RotateCwIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { Button } from "@/components/ui/button";
import { IconButton } from "./icon-button";
import { clampZoom, INITIAL_VIEW, layoutOf, rotateBy } from "./transform";

const PAD = 16;

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
  const [transformScale, setTransformScale] = useState(1);
  const [natural, setNatural] = useState<FmSize>();
  const [stageRef, stage] = useStageSize();
  const layout = natural && stage && layoutOf(natural, stage, view);
  const isImage = kind === "image";

  // Image keys: + / - zoom, 0 fit, R / Shift+R rotate, F flip. Active while focus is in the
  // preview's dialog or pane (not the tree, not text fields).
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const scale = layout?.scale;
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
        transformRef.current?.zoomIn(0.25);
      }
      else if (key === "-" && scale) {
        transformRef.current?.zoomOut(0.25);
      }
      else if (key === "0") {
        transformRef.current?.resetTransform();
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
  const style = layout && natural
    ? {
        position: "absolute" as const,
        left: "50%",
        top: "50%",
        width: natural.width * layout.scale,
        height: natural.height * layout.scale,
        maxWidth: "none",
        transform: `translate(-50%, -50%) rotate(${view.rotate}deg) scaleX(${view.flip
          ? -1
          : 1})`,
      }
    : { maxWidth: "100%", maxHeight: "100%" };

  const tools = (
    <>
      {isImage && layout && (
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          <IconButton label={labels.zoomOut} onClick={() => transformRef.current?.zoomOut(0.25)}><ZoomOutIcon /></IconButton>
          <Button size="sm" variant="ghost" className="w-14 tabular-nums" title={labels.fitToScreen} onClick={() => transformRef.current?.resetTransform()}>
            {`${Math.round(layout.scale * transformScale * 100)}%`}
          </Button>
          <IconButton label={labels.zoomIn} onClick={() => transformRef.current?.zoomIn(0.25)}><ZoomInIcon /></IconButton>
        </div>
      )}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        <IconButton label={labels.rotateLeft} onClick={() => setView(v => rotateBy(v, -90))}><RotateCcwIcon /></IconButton>
        <IconButton label={labels.rotateRight} onClick={() => setView(v => rotateBy(v, 90))}><RotateCwIcon /></IconButton>
        <IconButton label={labels.flip} aria-pressed={view.flip} onClick={() => setView(v => ({ ...v, flip: !v.flip }))}><FlipHorizontal2Icon /></IconButton>
      </div>
    </>
  );

  return (
    <div ref={setRoot} className={cn("flex h-full overflow-hidden", isImage ? "bg-muted/30" : "bg-black/90")} style={{ padding: PAD }}>
      {actions && createPortal(tools, actions)}
      <div ref={stageRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="relative m-auto shrink-0"
          style={layout
            ? { width: layout.width, height: layout.height }
            : undefined}
        >
          {isImage
            ? (
                <TransformWrapper
                  ref={transformRef}
                  smooth
                  centerOnInit
                  wheel={{ step: 0.08, touchPadDisabled: false }}
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
                    animationTime: 220,
                    animationType: "easeOut",
                  }}
                  pinch={{ step: 5, allowPanning: true }}
                  zoomAnimation={{ animationTime: 220, animationType: "easeOut" }}
                  autoAlignment={{ animationTime: 180, velocityAlignmentTime: 220 }}
                  minScale={1}
                  maxScale={4}
                  limitToBounds
                  centerZoomedOut
                  onTransform={(_, state) => setTransformScale(clampZoom(state.scale))}
                >
                  <TransformComponent
                    wrapperStyle={{ width: "100%", height: "100%" }}
                    contentStyle={{ width: "100%", height: "100%" }}
                  >
                    <img
                      src={src}
                      alt={alt}
                      draggable={false}
                      style={style}
                      className={view.zoom === undefined
                        ? "cursor-zoom-in"
                        : "cursor-grab"}
                      onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                    />
                  </TransformComponent>
                </TransformWrapper>
              )
            : (
                <video
                  src={src}
                  controls
                  style={style}
                  onLoadedMetadata={e => setNatural({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
                />
              )}
        </div>
      </div>
    </div>
  );
}

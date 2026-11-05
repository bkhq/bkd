import type { FmLabels } from "./labels";
import type { FmMediaView, FmSize } from "./transform";
import { cn } from "cn";
import { FlipHorizontal2Icon, RotateCcwIcon, RotateCwIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { IconButton } from "./icon-button";
import { clampZoom, INITIAL_VIEW, layoutOf, rotateBy, ZOOM_STEP } from "./transform";

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
  const [natural, setNatural] = useState<FmSize>();
  const [stageRef, stage] = useStageSize();
  const layout = natural && stage && layoutOf(natural, stage, view);
  const isImage = kind === "image";

  const zoomTo = (z: number) => setView(v => ({
    ...v,
    zoom: clampZoom(z),
  }));

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
        zoomTo(scale * ZOOM_STEP);
      }
      else if (key === "-" && scale) {
        zoomTo(scale / ZOOM_STEP);
      }
      else if (key === "0") {
        setView(v => ({ ...v, zoom: undefined }));
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
        <>
          <IconButton label={labels.zoomOut} onClick={() => zoomTo(layout.scale / ZOOM_STEP)}><ZoomOutIcon /></IconButton>
          <Button size="sm" variant="ghost" className="w-14 tabular-nums" title={labels.fitToScreen} onClick={() => setView(v => ({ ...v, zoom: undefined }))}>
            {`${Math.round(layout.scale * 100)}%`}
          </Button>
          <IconButton label={labels.zoomIn} onClick={() => zoomTo(layout.scale * ZOOM_STEP)}><ZoomInIcon /></IconButton>
        </>
      )}
      <IconButton label={labels.rotateLeft} onClick={() => setView(v => rotateBy(v, -90))}><RotateCcwIcon /></IconButton>
      <IconButton label={labels.rotateRight} onClick={() => setView(v => rotateBy(v, 90))}><RotateCwIcon /></IconButton>
      <IconButton label={labels.flip} aria-pressed={view.flip} onClick={() => setView(v => ({ ...v, flip: !v.flip }))}><FlipHorizontal2Icon /></IconButton>
    </>
  );

  return (
    <div ref={setRoot} className={cn("flex h-full overflow-auto", isImage ? "bg-muted/30" : "bg-black/90")} style={{ padding: PAD }}>
      {actions && createPortal(tools, actions)}
      <div ref={stageRef} className="flex min-h-0 min-w-0 flex-1">
        <div
          className="relative m-auto shrink-0"
          style={layout
            ? { width: layout.width, height: layout.height }
            : undefined}
        >
          {isImage
            ? (
                <img
                  src={src}
                  alt={alt}
                  draggable={false}
                  style={style}
                  className={view.zoom === undefined
                    ? "cursor-zoom-in"
                    : "cursor-zoom-out"}
                  onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                  onClick={() => setView(v => ({
                    ...v,
                    zoom: v.zoom === undefined
                      ? 1
                      : undefined,
                  }))}
                />
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

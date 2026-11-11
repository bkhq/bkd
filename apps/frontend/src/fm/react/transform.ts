/** View-only transform of an image or video in the preview (the file is not changed). */
export interface FmMediaView {
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
}

export const INITIAL_VIEW: FmMediaView = { rotate: 0, flip: false };

export function rotateBy(view: FmMediaView, degrees: 90 | -90): FmMediaView {
  return { ...view, rotate: ((view.rotate + degrees + 360) % 360) as FmMediaView["rotate"] };
}

export interface FmSize {
  width: number;
  height: number;
}

/** Fitted on-screen box of `natural` after rotation, and its scale; fit never upscales. */
export function layoutOf(natural: FmSize, stage: FmSize, view: FmMediaView): FmSize & { fit: number } {
  const turned = view.rotate % 180 !== 0;
  const w = turned
    ? natural.height
    : natural.width;
  const h = turned
    ? natural.width
    : natural.height;
  const fit = Math.min(1, stage.width / w, stage.height / h);
  return {
    width: w * fit,
    height: h * fit,
    fit,
  };
}

/** Zoom ceiling relative to the fitted size: 4x fit, and at least 4x the real size. */
export function maxZoomOf(fit: number): number {
  return Math.max(4, 4 / fit);
}

export interface FmPanZoom {
  scale: number;
  positionX: number;
  positionY: number;
}

/** Zooms by `factor` around `at` (viewport pixels), keeping that point in place; scale stays in [1, max]. */
export function zoomAround(view: FmPanZoom, factor: number, at: { x: number; y: number }, max: number): FmPanZoom {
  const scale = Math.min(max, Math.max(1, view.scale * factor));
  const ratio = scale / view.scale;
  return {
    scale,
    positionX: at.x - (at.x - view.positionX) * ratio,
    positionY: at.y - (at.y - view.positionY) * ratio,
  };
}

function clampAxis(position: number, content: number, viewport: number): number {
  return content <= viewport
    ? (viewport - content) / 2
    : Math.min(0, Math.max(viewport - content, position));
}

/** Keeps `content` (unscaled size) over the viewport; an axis that fits is centred. */
export function clampPan(view: FmPanZoom, content: FmSize, viewport: FmSize): FmPanZoom {
  return {
    scale: view.scale,
    positionX: clampAxis(view.positionX, content.width * view.scale, viewport.width),
    positionY: clampAxis(view.positionY, content.height * view.scale, viewport.height),
  };
}

/** The view at `scale` centred on a point given as fractions of the content, within bounds. */
export function centerOn(at: { x: number; y: number }, scale: number, content: FmSize, viewport: FmSize): FmPanZoom {
  return clampPan({
    scale,
    positionX: viewport.width / 2 - at.x * content.width * scale,
    positionY: viewport.height / 2 - at.y * content.height * scale,
  }, content, viewport);
}

/** Wheel pixels per notch; one notch zooms by `NOTCH_ZOOM`. */
const NOTCH_PX = 100;
const NOTCH_ZOOM = 1.2;

/** Zoom factor of one wheel event: lines (16px) and pages become pixels, capped at one notch. */
export function wheelFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  const px = deltaY * (deltaMode === 1
    ? 16
    : deltaMode === 2
      ? pageHeight
      : 1);
  return NOTCH_ZOOM ** (-Math.max(-NOTCH_PX, Math.min(NOTCH_PX, px)) / NOTCH_PX);
}

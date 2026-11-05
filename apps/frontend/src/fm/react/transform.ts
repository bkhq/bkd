/** View-only transform of an image or video in the preview (the file is not changed). */
export interface FmMediaView {
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
  /** `undefined` = fit into the stage. */
  zoom?: number | undefined;
}

export const INITIAL_VIEW: FmMediaView = { rotate: 0, flip: false };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

export function rotateBy(view: FmMediaView, degrees: 90 | -90): FmMediaView {
  return { ...view, rotate: ((view.rotate + degrees + 360) % 360) as FmMediaView["rotate"] };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export interface FmSize {
  width: number;
  height: number;
}

/** Scale and on-screen box of `natural` after rotation; fit never upscales. */
export function layoutOf(natural: FmSize, stage: FmSize, view: FmMediaView): FmSize & { scale: number; fit: number } {
  const turned = view.rotate % 180 !== 0;
  const w = turned
    ? natural.height
    : natural.width;
  const h = turned
    ? natural.width
    : natural.height;
  const fit = Math.min(1, stage.width / w, stage.height / h);
  const scale = view.zoom ?? fit;
  return {
    width: w * scale,
    height: h * scale,
    scale,
    fit,
  };
}

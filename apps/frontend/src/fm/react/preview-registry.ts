import type { ComponentType } from "react";
import type { FmEntry } from "../core/schema";
import type { PreviewProps } from "./previewers";
import { FallbackPreview, ImagePreview, LazyTextPreview, MediaPreview, PdfPreview, SniffPreview, SvgPreview } from "./previewers";
import { kindOf } from "./state";

export interface FmPreviewer {
  id: string;
  match: (entry: FmEntry) => boolean;
  component: ComponentType<PreviewProps>;
  /** Higher wins; built-ins use 0. */
  priority?: number;
}

const previewers: readonly FmPreviewer[] = [
  {
    id: "svg",
    match: e => e.kind === "file" && (e.mime === "image/svg+xml" || /\.svg$/i.test(e.name)),
    component: SvgPreview,
    priority: 1,
  },
  {
    id: "image",
    match: e => kindOf(e) === "image",
    component: ImagePreview,
  },
  {
    id: "media",
    match: e => ["video", "audio"].includes(kindOf(e)),
    component: MediaPreview,
  },
  {
    id: "pdf",
    match: e => kindOf(e) === "pdf",
    component: PdfPreview,
  },
  {
    id: "text",
    match: e => kindOf(e) === "text",
    component: LazyTextPreview,
  },
  {
    id: "sniff",
    match: e => kindOf(e) === "other" && e.size <= 2 * 1024 * 1024,
    component: SniffPreview,
  },
];

/** Best previewer for `entry`; `extra` (from plugins) competes with the built-ins. */
export function findPreviewer(entry: FmEntry, extra: readonly FmPreviewer[] = []): ComponentType<PreviewProps> {
  const match = [
    ...previewers,
    ...extra,
  ]
    .filter(p => p.match(entry))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  return match?.component ?? FallbackPreview;
}

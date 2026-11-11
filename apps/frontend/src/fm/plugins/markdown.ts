import type { FmPlugin } from "../react/plugins";
import { lazy } from "react";

// One component per option value, so `markdownPlugin()` inline in JSX never remounts the previewer.
const MarkdownPreview = lazy(() => import("./markdown-view").then(m => ({ default: m.MarkdownPreview })));
const MarkdownPreviewRemoteImages = lazy(() => import("./markdown-view").then(m => ({ default: m.MarkdownPreviewRemoteImages })));

export const MARKDOWN_FILE = /\.(?:md|markdown)$/i;

export interface FmMarkdownPluginOptions {
  /**
   * Load images from any host. Off by default: an image URL in an untrusted
   * Markdown file would tell its host the viewer's IP address and when the
   * file was opened. Off, only relative, same-origin and `data:image/...`
   * images load; others show their alt text.
   */
  remoteImages?: boolean;
}

/** Rendered Markdown (GFM, highlighted code) with a toggle to the text editor. Loads only when a Markdown file is opened. */
export function markdownPlugin({ remoteImages = false }: FmMarkdownPluginOptions = {}): FmPlugin {
  return {
    id: "markdown",
    previewers: [
      {
        id: "markdown",
        match: e => e.kind === "file" && MARKDOWN_FILE.test(e.name),
        component: remoteImages
          ? MarkdownPreviewRemoteImages
          : MarkdownPreview,
        // Wins over the built-in text editor.
        priority: 10,
      },
    ],
  };
}

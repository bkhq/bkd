import type { FmPlugin } from "../react/plugins";
import { lazy } from "react";

const MarkdownPreview = lazy(() => import("./markdown-view").then(m => ({ default: m.MarkdownPreview })));

export const MARKDOWN_FILE = /\.(?:md|markdown)$/i;

/** Rendered Markdown (GFM, highlighted code) with a toggle to the text editor. Loads only when a Markdown file is opened. */
export function markdownPlugin(): FmPlugin {
  return {
    id: "markdown",
    previewers: [
      {
        id: "markdown",
        match: e => e.kind === "file" && MARKDOWN_FILE.test(e.name),
        component: MarkdownPreview,
        // Wins over the built-in text editor.
        priority: 10,
      },
    ],
  };
}

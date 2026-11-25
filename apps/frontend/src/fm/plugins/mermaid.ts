import type { FmPlugin } from "../react/plugins";
import { createElement, lazy, Suspense } from "react";

const MermaidPreview = lazy(() => import("./mermaid-view").then(m => ({ default: m.MermaidPreview })));
const LazyDiagram = lazy(() => import("./mermaid-view").then(m => ({ default: m.MermaidDiagram })));

/** A diagram inside other content: loads on its own instead of suspending the whole preview. */
function MermaidBlock({ code }: { code: string }) {
  return createElement(Suspense, { fallback: null }, createElement(LazyDiagram, { code }));
}

export const MERMAID_FILE = /\.(?:mmd|mermaid)$/i;

/**
 * Mermaid diagrams: `.mmd` / `.mermaid` files open as the diagram with a source
 * toggle, and ```` ```mermaid ```` blocks render as diagrams in the Markdown
 * preview (with `markdownPlugin()`). mermaid loads with the first diagram.
 */
export function mermaidPlugin(): FmPlugin {
  return {
    id: "mermaid",
    previewers: [
      {
        id: "mermaid",
        match: e => e.kind === "file" && MERMAID_FILE.test(e.name),
        component: MermaidPreview,
        // Wins over the built-in text editor.
        priority: 10,
      },
    ],
    codeRenderers: [
      {
        language: "mermaid",
        component: MermaidBlock,
      },
    ],
  };
}

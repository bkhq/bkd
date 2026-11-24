import type { Mermaid } from "mermaid";
import type { PreviewProps } from "../react/previewers";
import { useEffect, useId, useState } from "react";
import { SourcePreview } from "../react/source-preview";

let loading: Promise<Mermaid> | undefined;
/** mermaid is large: loaded with the first diagram, once. */
const loadMermaid = () => loading ??= import("mermaid").then(m => m.default);

/** Whether the page uses the dark theme (shadcn's `dark` class on `<html>`), kept current. */
function useDarkTheme() {
  const root = typeof document !== "undefined"
    ? document.documentElement
    : undefined;
  const [dark, setDark] = useState(() => !!root?.classList.contains("dark"));
  useEffect(() => {
    if (!root)
      return;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [root]);
  return dark;
}

/** A Mermaid diagram drawn from `code`; a syntax error shows mermaid's message. */
export function MermaidDiagram({ code }: { code: string }) {
  const id = `fm-mermaid-${useId().replace(/[^\w-]/g, "")}`;
  const dark = useDarkTheme();
  const [result, setResult] = useState<{ svg: string } | { error: string }>();
  useEffect(() => {
    if (!code.trim())
      return;
    let live = true;
    // Waits for typing to pause while the source is edited beside the diagram.
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        // `strict` sanitizes labels and drops click handlers and scripts.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: dark
            ? "dark"
            : "default",
        });
        const { svg } = await mermaid.render(id, code);
        if (live)
          setResult({ svg });
      }
      catch (e) {
        if (live) {
          setResult({
            error: e instanceof Error
              ? e.message
              : String(e),
          });
        }
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code, dark, id]);

  if (!result || !code.trim())
    return null;
  if ("error" in result)
    return <pre className="overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap text-destructive">{result.error}</pre>;
  return (
    <div
      className="flex justify-center overflow-auto [&_svg]:h-auto [&_svg]:max-w-full"
      data-fm-mermaid=""
      // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- sanitized by mermaid (`securityLevel: "strict"`).
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}

/** A `.mmd` file: the diagram first, with the source editor instead or beside it. */
export function MermaidPreview(props: PreviewProps) {
  return (
    <SourcePreview
      {...props}
      layoutId="fm-mermaid"
      initialMode="preview"
      render={text => <div className="p-6"><MermaidDiagram code={text} /></div>}
    />
  );
}

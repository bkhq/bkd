/** The part of mermaid the renderer uses. */
export interface FmMermaidApi {
  initialize: (config: { startOnLoad: boolean; securityLevel: "strict"; suppressErrorRendering: boolean; theme: "dark" | "default" }) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

/**
 * Renders diagrams one at a time. `initialize` sets mermaid's site-wide config,
 * so a diagram initializing (e.g. with another theme) while another renders can
 * reset that render and leave it blank; each initialize + render pair runs alone.
 */
export function createMermaidRenderer(load: () => Promise<FmMermaidApi>) {
  let queue: Promise<unknown> = Promise.resolve();
  return (id: string, code: string, dark: boolean): Promise<string> => {
    const run = queue.then(async () => {
      const mermaid = await load();
      // `strict` sanitizes labels and drops click handlers and scripts.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: dark
          ? "dark"
          : "default",
      });
      return (await mermaid.render(id, code)).svg;
    });
    // A failed diagram does not stop the ones queued after it.
    queue = run.catch(() => {});
    return run;
  };
}

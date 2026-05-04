import { useEffect, useId, useState } from 'react'
import { useTheme } from '@/hooks/use-theme'

// Mermaid is heavy (~600KB minified). Import it lazily on first use so the
// initial bundle isn't penalised for the (probably) common case where the
// rendered chat stream contains no diagrams.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => m.default)
  }
  return mermaidPromise
}

interface MermaidDiagramProps {
  code: string
}

/**
 * Render a mermaid diagram from raw source. Re-renders on theme change so
 * the SVG stays legible across light/dark switches. Falls back to showing
 * the source code in a `<pre>` if mermaid throws (typically a syntax error
 * in the LLM-generated diagram).
 */
export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { resolved } = useTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Stable id keeps mermaid happy when re-rendering — it embeds the id into
  // generated nodes and complains about duplicates if a Math.random() id
  // collides between two simultaneous renders on the same page.
  const reactId = useId()
  const renderId = `mermaid-${reactId.replaceAll(':', '')}`

  useEffect(() => {
    let cancelled = false
    setError(null)
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: resolved === 'dark' ? 'dark' : 'default',
          // Disable mermaid's default "max-width: 100%" so we can size via the
          // wrapper.  Also disable the security check that strips href/onclick
          // — the SVG is sanitised by mermaid itself for built-in diagrams.
          securityLevel: 'strict',
          fontFamily: 'inherit',
        })
        const result = await mermaid.render(renderId, code.trim())
        if (!cancelled) setSvg(result.svg)
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        // Mermaid leaves an orphaned div behind in the DOM when it fails;
        // remove it so a re-render doesn't trip over a leftover.
        document.getElementById(renderId)?.remove()
      })
    return () => {
      cancelled = true
    }
  }, [code, resolved, renderId])

  if (error) {
    return (
      <div className="my-3 rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <div className="px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 border-b border-amber-500/20 bg-amber-500/10">
          mermaid:
          {' '}
          {error}
        </div>
        <pre className="text-[12px] p-3 overflow-x-auto whitespace-pre-wrap font-mono text-foreground/80">
          {code}
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="my-3 rounded-md border border-border/40 bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground/60">
        Rendering diagram…
      </div>
    )
  }

  return (
    <div
      className="mermaid-diagram my-3 flex justify-center overflow-x-auto rounded-md border border-border/30 bg-muted/10 p-3"
      // Mermaid output is sanitised by mermaid itself when securityLevel='strict'.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

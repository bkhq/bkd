import { Maximize2, Minus, Plus, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
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
 *
 * Adds a "zoom" affordance: chat-rendered diagrams are often too small to
 * read. Clicking the diagram (or the corner button) opens a fullscreen
 * lightbox with pan + zoom controls.
 */
export function MermaidDiagram({ code }: MermaidDiagramProps) {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)
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
    <>
      <div className="mermaid-diagram group/mermaid relative my-3 rounded-md border border-border/30 bg-muted/10">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setZoomOpen(true)
          }}
          // Always-visible, solid-contrast button. Earlier iterations used
          // hover-only or low-opacity treatments which were reported as
          // invisible on light backgrounds and touch devices.
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={t('common.enlarge')}
          title={t('common.enlarge')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('common.enlarge')}</span>
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setZoomOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setZoomOpen(true)
            }
          }}
          className="flex justify-center overflow-x-auto p-3 cursor-zoom-in"
          aria-label={t('common.enlarge')}
          // Mermaid output is sanitised by mermaid itself when securityLevel='strict'.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {zoomOpen ? <MermaidZoomViewer svg={svg} onClose={() => setZoomOpen(false)} /> : null}
    </>
  )
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 8
const ZOOM_STEP = 1.25

/**
 * Fullscreen lightbox that hosts the rendered SVG with mouse-wheel / button
 * zoom and click-drag pan. The transform is applied to a wrapper element so
 * we never re-layout the SVG itself (cheaper, plus mermaid's own viewBox is
 * preserved). Esc / backdrop click closes; the previously-focused element
 * is restored on unmount to keep keyboard flow tidy.
 */
function MermaidZoomViewer({ svg, onClose }: { svg: string, onClose: () => void }) {
  const { t } = useTranslation()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number, startY: number, baseX: number, baseY: number } | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Esc + focus preservation
  useEffect(() => {
    prevFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === '+' || e.key === '=') {
        setScale(s => Math.min(ZOOM_MAX, s * ZOOM_STEP))
      } else if (e.key === '-' || e.key === '_') {
        setScale(s => Math.max(ZOOM_MIN, s / ZOOM_STEP))
      } else if (e.key === '0') {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const prev = prevFocusRef.current
      if (prev && document.contains(prev)) prev.focus()
    }
  }, [onClose])

  // React's synthetic `onWheel` is registered as a passive listener, so
  // `e.preventDefault()` is silently ignored and the chat behind us still
  // scrolls. Attach a native non-passive listener so the wheel can be
  // properly captured for zoom without leaking to ancestors.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Trackpad-pinch and ctrl+wheel report large deltaY values; clamp
      // them to a steady per-event step so a single pinch gesture doesn't
      // blow past the zoom range.
      const direction = e.deltaY < 0 ? 1 : -1
      setScale(s => clamp(direction > 0 ? s * ZOOM_STEP : s / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    }
  }, [offset])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setOffset({
      x: dragRef.current.baseX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.baseY + (e.clientY - dragRef.current.startY),
    })
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  // Portal to document.body so the overlay isn't clipped by the chat
  // scroll container (`overflow-y-auto` in ChatBody establishes a
  // containing block that `fixed` cannot escape). Lock background scroll
  // for good measure while the lightbox is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Backdrop uses the theme background, NOT pure black. Mermaid generates
  // the SVG against its own theme (light = dark-on-white, dark = light-on-
  // gray); a hard black backdrop drowned the dark-theme strokes and looked
  // wrong in light mode. `bg-background` follows the same theme switch
  // mermaid uses, so node fills and connecting lines stay legible.
  const node = (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={t('common.enlarge')}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setScale(s => Math.max(ZOOM_MIN, s / ZOOM_STEP))}
            className="rounded p-1 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
            aria-label={t('common.zoomOut')}
            title={t('common.zoomOut')}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-foreground/80">
            {Math.round(scale * 100)}
            %
          </span>
          <button
            type="button"
            onClick={() => setScale(s => Math.min(ZOOM_MAX, s * ZOOM_STEP))}
            className="rounded p-1 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
            aria-label={t('common.zoomIn')}
            title={t('common.zoomIn')}
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={reset}
            className="ml-1 rounded p-1 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
            aria-label={t('common.resetZoom')}
            title={t('common.resetZoom')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Viewport — wheel zoom + click-drag pan. Backdrop click closes when
       * the click lands on the viewport itself (not on the SVG).
       * Wheel handler is attached natively (non-passive) via useEffect. */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 origin-center mermaid-zoom-svg [&>svg]:!max-w-none [&>svg]:!h-auto"
          style={{
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragRef.current ? 'none' : 'transform 80ms ease-out',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )

  return createPortal(node, document.body)
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

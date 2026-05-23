import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PathChip, splitByKnownPaths, transformChildrenWithPathChips } from '@/lib/path-chips'

const { lazy, Suspense, useCallback, useMemo } = React

const MermaidDiagram = lazy(() =>
  import('@/components/MermaidDiagram').then(m => ({ default: m.MermaidDiagram })),
)
const ShikiCodeBlock = lazy(() =>
  import('@/components/files/ShikiCodeBlock').then(m => ({ default: m.ShikiCodeBlock })),
)

/**
 * Render an inline assistant / user message as actual markdown.
 *
 * Was previously a single Shiki tokenisation pass over the raw markdown
 * source — fast and stream-stable, but visually it left every `**`, `#`,
 * `-`, table pipe, etc. on screen as colourful syntax markers instead of
 * applying the formatting they describe. The chat read like an IDE diff
 * instead of a conversation.
 *
 * Now we run the same react-markdown + remark-gfm pipeline that the
 * "view full message" dialog uses, with three concessions tuned for the
 * inline chat-bubble context:
 *
 *  1. Code blocks defer to ShikiCodeBlock (lazy), exactly like the dialog,
 *     so syntax-highlighting cost only kicks in when the content actually
 *     contains code.
 *  2. ` ```mermaid ` blocks render as actual diagrams via MermaidDiagram.
 *  3. The wrapper class is `markdown-chat` (light typography, no
 *     github-markdown-css reset) so messages still feel like chat lines,
 *     not like a rendered README inside a bubble.
 *
 * Streaming consideration: react-markdown is robust to incomplete input
 * (open code fences, half-written tables) — it just renders what it can
 * and re-renders cleanly when the next chunk arrives. We deliberately do
 * NOT preprocess the content, so streaming chunks arrive intact.
 */
export function MarkdownContent({
  content,
  className: containerClassName = '',
  knownPaths,
  onPathClick,
}: {
  content: string
  className?: string
  /**
   * Pre-sorted whitelist of file paths to recognize inside plain text.
   * When provided together with `onPathClick`, matched substrings become
   * clickable inline chips. When empty / undefined, text is rendered as-is.
   */
  knownPaths?: string[]
  /** Click handler bound to each generated path chip. */
  onPathClick?: (path: string, line?: number) => void
}) {
  const renderPre = useCallback(
    ({ children }: React.HTMLAttributes<HTMLPreElement>) => <>{children}</>,
    [],
  )

  const chipsEnabled = !!onPathClick && !!knownPaths && knownPaths.length > 0
  const renderCode = useCallback(
    ({
      className,
      children,
      ...rest
    }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
      const text = String(children ?? '')
      const isBlock = className || text.includes('\n')

      if (isBlock) {
        const code = text.replace(/\n$/, '')
        const lang = className?.replace('language-', '') ?? 'text'
        if (lang === 'mermaid') {
          return (
            <Suspense
              fallback={(
                <div className="my-3 rounded-md border border-border/40 bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground/60">
                  Loading diagram…
                </div>
              )}
            >
              <MermaidDiagram code={code} />
            </Suspense>
          )
        }
        return (
          <Suspense
            fallback={(
              <pre className="my-2 overflow-x-auto rounded-md bg-muted/40 p-3 text-[12px] font-mono">
                {code}
              </pre>
            )}
          >
            <ShikiCodeBlock code={code} lang={lang} />
          </Suspense>
        )
      }

      // Inline `<code>`: AI almost always wraps file paths in backticks, so
      // an `<code>` whose entire content is a known path should render as a
      // clickable PathChip instead of plain inline-code styling. We require
      // EXACT match (after trim + the suffix capture in splitByKnownPaths)
      // so we never accidentally chip-ify a partial-path-shaped string.
      if (chipsEnabled) {
        const segments = splitByKnownPaths(text.trim(), knownPaths!)
        const onlySegment = segments.length === 1 ? segments[0] : null
        if (onlySegment && onlySegment.type === 'path') {
          return (
            <PathChip
              path={onlySegment.path}
              line={onlySegment.line}
              matched={onlySegment.matched}
              onClick={onPathClick!}
            />
          )
        }
      }

      return (
        <code
          className="rounded bg-muted/80 px-1.5 py-0.5 text-[0.9em] font-mono ring-1 ring-border/50 whitespace-nowrap"
          {...rest}
        >
          {children}
        </code>
      )
    },
    [chipsEnabled, knownPaths, onPathClick],
  )

  // Open links from chat messages in a new tab — they're typically docs
  // referenced by the AI, not part of the kanban app itself.
  const renderAnchor = useCallback(
    (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        {...props}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:opacity-80"
      />
    ),
    [],
  )

  // Inline-text renderer factory. We re-use a single transform function
  // bound to current `knownPaths` + `onPathClick` and reuse it across
  // p/li/td/em/strong, keeping these as simple render callbacks (not nested
  // components — see eslint react/no-nested-component-definitions).
  const renderInlineTag = useMemo(() => {
    if (!chipsEnabled) return null
    const transform = (children: React.ReactNode) =>
      transformChildrenWithPathChips(children, knownPaths!, onPathClick!)
    return (tag: 'p' | 'li' | 'td' | 'em' | 'strong') =>
      ({ children, ...rest }: React.HTMLAttributes<HTMLElement>) =>
        React.createElement(tag, rest, transform(children))
  }, [chipsEnabled, knownPaths, onPathClick])

  const components = useMemo(
    () => {
      const base: Record<string, unknown> = {
        pre: renderPre,
        code: renderCode,
        a: renderAnchor,
      }
      if (renderInlineTag) {
        base.p = renderInlineTag('p')
        base.li = renderInlineTag('li')
        base.td = renderInlineTag('td')
        base.em = renderInlineTag('em')
        base.strong = renderInlineTag('strong')
      }
      return base
    },
    [renderPre, renderCode, renderAnchor, renderInlineTag],
  )

  return (
    <div className={`markdown-chat ${containerClassName}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}

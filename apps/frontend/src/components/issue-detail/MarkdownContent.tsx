import { lazy, Suspense, useCallback, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
}: {
  content: string
  className?: string
}) {
  const renderPre = useCallback(
    ({ children }: React.HTMLAttributes<HTMLPreElement>) => <>{children}</>,
    [],
  )

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

      return (
        <code
          className="rounded bg-muted/70 px-1.5 py-0.5 text-[0.9em] font-mono"
          {...rest}
        >
          {children}
        </code>
      )
    },
    [],
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

  const components = useMemo(
    () => ({
      pre: renderPre,
      code: renderCode,
      a: renderAnchor,
    }),
    [renderPre, renderCode, renderAnchor],
  )

  return (
    <div className={`markdown-chat ${containerClassName}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}

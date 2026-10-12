import { Streamdown } from 'streamdown'
import { markdownCodeComponents } from '@/components/markdown-code'

export function MarkdownContent({
  content,
  className = '',
  isStreaming = false,
}: {
  content: string
  className?: string
  /** Entry is still receiving deltas; lets streamdown repair unterminated markup. */
  isStreaming?: boolean
}) {
  if (!content.trim()) return null
  return (
    <Streamdown
      mode="streaming"
      isAnimating={isStreaming}
      controls={false}
      lineNumbers={false}
      components={markdownCodeComponents}
      // Opt out of the global touch-action: manipulation so touch devices can long-press to select.
      className={`touch-auto select-text ${className}`}
    >
      {content}
    </Streamdown>
  )
}

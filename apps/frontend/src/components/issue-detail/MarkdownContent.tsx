import type { ComponentProps } from 'react'
import { Streamdown } from 'streamdown'
import { markdownCodeComponents } from '@/components/markdown-code'
import { useViewModeStore } from '@/stores/view-mode-store'
import { cn } from 'cn'
import { MarkdownSource } from './MarkdownSource'

type TagProps<T extends 'h1' | 'table' | 'thead' | 'th' | 'td'> = ComponentProps<T> & { node?: unknown }

// Sized in em so headings stay proportionate to the 14px chat body and the 12px tool panels.
const HEADING_CLASS = {
  h1: 'mt-[1em] mb-[0.4em] text-[1.5em] font-bold leading-snug',
  h2: 'mt-[1.2em] mb-[0.4em] text-[1.25em] font-semibold leading-snug',
  h3: 'mt-[1.2em] mb-[0.3em] text-[1.1em] font-semibold leading-snug',
  h4: 'mt-[1.2em] mb-[0.3em] text-[1em] font-semibold',
  h5: 'mt-[1.2em] mb-[0.3em] text-[1em] font-semibold',
  h6: 'mt-[1.2em] mb-[0.3em] text-[1em] font-semibold',
} as const

function heading(Tag: keyof typeof HEADING_CLASS) {
  return ({ node: _node, className, ...props }: TagProps<'h1'>) => (
    <Tag className={cn(HEADING_CLASS[Tag], 'first:mt-0', className)} {...props} />
  )
}

function Table({ node: _node, className, ...props }: TagProps<'table'>) {
  return (
    <div className="my-2 overflow-x-auto">
      <table className={cn('w-full border-collapse text-[0.93em]', className)} {...props} />
    </div>
  )
}

function TableHead({ node: _node, className, ...props }: TagProps<'thead'>) {
  return <thead className={cn('border-b border-border', className)} {...props} />
}

function HeaderCell({ node: _node, className, ...props }: TagProps<'th'>) {
  return <th className={cn('whitespace-nowrap px-2.5 py-1 text-left font-semibold', className)} {...props} />
}

function Cell({ node: _node, className, ...props }: TagProps<'td'>) {
  return <td className={cn('px-2.5 py-1 align-top', className)} {...props} />
}

const chatComponents = {
  ...markdownCodeComponents,
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  h5: heading('h5'),
  h6: heading('h6'),
  table: Table,
  thead: TableHead,
  th: HeaderCell,
  td: Cell,
}

export function MarkdownContent({
  content,
  className = '',
  isStreaming = false,
  render,
}: {
  content: string
  className?: string
  /** Entry is still receiving deltas; lets streamdown repair unterminated markup. */
  isStreaming?: boolean
  /** Per-message choice; defaults to the global "render Markdown" setting. */
  render?: boolean
}) {
  const renderSetting = useViewModeStore(s => s.renderMarkdown)
  const renderMarkdown = render ?? renderSetting
  if (!renderMarkdown) return <MarkdownSource content={content} className={className} />
  if (!content.trim()) return null
  return (
    <Streamdown
      mode={isStreaming ? 'streaming' : 'static'}
      isAnimating={isStreaming}
      controls={false}
      lineNumbers={false}
      components={chatComponents}
      // Opt out of the global touch-action: manipulation so touch devices can long-press to select.
      className={`touch-auto select-text ${className}`}
    >
      {content}
    </Streamdown>
  )
}

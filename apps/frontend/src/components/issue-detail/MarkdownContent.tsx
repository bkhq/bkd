import DOMPurify from 'dompurify'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { codeToHtml } from '@/lib/shiki'

const MermaidDiagram = lazy(() =>
  import('@/components/MermaidDiagram').then(m => ({ default: m.MermaidDiagram })),
)

interface MermaidSegment { type: 'mermaid', code: string }
interface TextSegment { type: 'text', content: string }
type ContentSegment = TextSegment | MermaidSegment

/**
 * Split a markdown blob into alternating text / mermaid segments so the
 * mermaid blocks can be rendered as actual diagrams while the rest still
 * goes through the existing Shiki-highlighting fast path. Returns one text
 * segment with the entire input when no mermaid blocks are present.
 */
function splitMermaidBlocks(input: string): ContentSegment[] {
  // [ \t]* (not \s*) before the newline avoids polynomial backtracking against
  // the [\s\S]*? body — important because LLM output can be long.
  const re = /```mermaid[ \t]*\n([\s\S]*?)```/g
  const segments: ContentSegment[] = []
  let lastIdx = 0
  let m = re.exec(input)
  while (m !== null) {
    if (m.index > lastIdx) {
      segments.push({ type: 'text', content: input.slice(lastIdx, m.index) })
    }
    segments.push({ type: 'mermaid', code: m[1].replace(/\n+$/, '') })
    lastIdx = m.index + m[0].length
    m = re.exec(input)
  }
  if (segments.length === 0) {
    return [{ type: 'text', content: input }]
  }
  if (lastIdx < input.length) {
    segments.push({ type: 'text', content: input.slice(lastIdx) })
  }
  return segments
}

/** Calculate display width accounting for CJK characters (width 2). */
function displayWidth(str: string): number {
  let w = 0
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0
    // CJK Unified Ideographs, CJK Compatibility, Fullwidth forms, etc.
    if (
      (code >= 0x2E80 && code <= 0x9FFF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE30 && code <= 0xFE4F) ||
      (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x2FA1F)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

/** Pad string with spaces to reach target display width. */
function padEnd(str: string, targetWidth: number): string {
  const diff = targetWidth - displayWidth(str)
  return diff > 0 ? str + ' '.repeat(diff) : str
}

/** Reformat a markdown table block with space-padded columns. */
function formatTable(block: string): string {
  const lines = block.split('\n').filter(l => l.trim())
  if (lines.length < 2) return block

  const parseCells = (line: string) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim())

  const isSep = (line: string) => /^\|?[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?$/.test(line.trim())

  if (!isSep(lines[1])) return block

  const allCells = lines.filter(l => !isSep(l)).map(parseCells)
  const colCount = Math.max(...allCells.map(r => r.length))

  // Calculate max display width per column
  const colWidths: number[] = new Array(colCount).fill(0)
  for (const row of allCells) {
    for (let i = 0; i < colCount; i++) {
      const w = displayWidth(row[i] ?? '')
      if (w > colWidths[i]) colWidths[i] = w
    }
  }

  const formatRow = (cells: string[]) => {
    const padded = Array.from({ length: colCount }, (_, i) => padEnd(cells[i] ?? '', colWidths[i]))
    return `| ${padded.join(' | ')} |`
  }

  const sepLine = `| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`

  const header = parseCells(lines[0])
  const dataRows = lines
    .slice(2)
    .filter(l => !isSep(l))
    .map(parseCells)

  return [formatRow(header), sepLine, ...dataRows.map(formatRow)].join('\n')
}

/** Pre-process content: format tables with space padding for monospace alignment. */
function preprocessContent(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let tableBuf: string[] = []

  const flushTable = () => {
    if (tableBuf.length > 0) {
      result.push(formatTable(tableBuf.join('\n')))
      tableBuf = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1
    if (isTableLine) {
      tableBuf.push(line)
    } else {
      flushTable()
      result.push(line)
    }
  }
  flushTable()
  return result.join('\n')
}

export function MarkdownContent({
  content,
  className: containerClassName = '',
}: {
  content: string
  className?: string
}) {
  const segments = useMemo(() => splitMermaidBlocks(content), [content])

  // Fast path: no mermaid blocks → behave exactly like before. Avoids the
  // wrapper div / extra component renders for the (vast majority) case.
  if (segments.length === 1 && segments[0].type === 'text') {
    return (
      <ShikiTextSegment
        content={segments[0].content}
        containerClassName={containerClassName}
      />
    )
  }

  return (
    <div className={`markdown-shiki ${containerClassName}`}>
      {segments.map((seg, i) =>
        seg.type === 'text' ?
            (
              <ShikiTextSegment
                key={i}
                content={seg.content}
                containerClassName=""
                inline
              />
            ) :
            (
              <Suspense
                key={i}
                fallback={(
                  <div className="my-3 rounded-md border border-border/40 bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground/60">
                    Loading diagram…
                  </div>
                )}
              >
                <MermaidDiagram code={seg.code} />
              </Suspense>
            ),
      )}
    </div>
  )
}

/**
 * Inner Shiki-rendered text segment. When `inline=true` the wrapper div /
 * className is dropped because the parent MarkdownContent already provides
 * the `markdown-shiki` container — we don't want nested ones, which would
 * double up the styling.
 */
function ShikiTextSegment({
  content,
  containerClassName,
  inline = false,
}: {
  content: string
  containerClassName: string
  inline?: boolean
}) {
  const formatted = useMemo(() => preprocessContent(content), [content])
  const [html, setHtml] = useState('')

  useEffect(() => {
    setHtml('')
    let cancelled = false
    void codeToHtml(formatted, 'markdown').then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [formatted])

  if (!html) {
    if (inline) {
      return <pre className="whitespace-pre-wrap break-words">{formatted}</pre>
    }
    return (
      <div className={`markdown-shiki ${containerClassName}`}>
        <pre className="whitespace-pre-wrap break-words">{formatted}</pre>
      </div>
    )
  }

  if (inline) {
    return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
  }

  return (
    <div
      className={`markdown-shiki ${containerClassName}`}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  )
}

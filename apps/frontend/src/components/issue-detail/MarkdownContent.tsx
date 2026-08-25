import DOMPurify from 'dompurify'
import { useEffect, useMemo, useState } from 'react'
import { codeToHtml } from '@/lib/shiki'

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

/** Markdown image whose src is a safe, renderable source (served file or data URI). */
const IMAGE_MD_RE = /!\[([^\]]*)\]\((data:image\/[^)\s]+|\/api\/[^)\s]+|https?:\/\/[^)\s]+)\)/g

interface ExtractedImage {
  alt: string
  src: string
}

/**
 * Pull renderable image references out of the content; returns the images and
 * the remaining text (with those image markdowns removed).
 */
function splitImages(content: string): { images: ExtractedImage[], text: string } {
  const images: ExtractedImage[] = []
  const text = content.replace(IMAGE_MD_RE, (_m, alt: string, src: string) => {
    images.push({ alt: alt || 'image', src })
    return ''
  })
  return { images, text: text.trim() }
}

export function MarkdownContent({
  content,
  className: containerClassName = '',
}: {
  content: string
  className?: string
}) {
  const { images, text } = useMemo(() => splitImages(content), [content])
  const formatted = useMemo(() => preprocessContent(text), [text])
  const [html, setHtml] = useState('')

  useEffect(() => {
    setHtml('')
    if (!formatted) return
    let cancelled = false
    void codeToHtml(formatted, 'markdown').then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [formatted])

  return (
    <div className={`markdown-shiki ${containerClassName}`}>
      {images.map(img => (
        <img
          key={img.src}
          src={img.src}
          alt={img.alt}
          className="my-2 max-w-full h-auto rounded-md border border-foreground/10"
          loading="lazy"
        />
      ))}
      {formatted
        ? (
            html
              ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
              : <pre className="whitespace-pre-wrap break-words">{formatted}</pre>
          )
        : null}
    </div>
  )
}

import { FileWarning } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileContent } from '@/types/kanban'

/**
 * Table preview branch used by `FileViewer` for CSV / TSV / XLSX files.
 *
 * - CSV / TSV: parse `file.content` (already loaded as text by the `/show`
 *   endpoint) with papaparse.
 * - XLSX / XLS: fetch the raw bytes via `rawFileUrl` and parse with sheetjs.
 *   sheetjs is heavy (~430 KB minified) so it is dynamic-imported only when
 *   the viewer actually mounts for an Excel file.
 *
 * Rendering uses `@tanstack/react-virtual` so multi-thousand-row sheets
 * don't blow up the DOM. Truncation cap is enforced inside `parseRows` so
 * we never hold the entire workbook in React state.
 */

const ROW_LIMIT = 1000

interface ParsedTable {
  /** First row treated as header; falls back to synthetic A/B/C labels. */
  headers: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

interface ParsedWorkbook {
  sheetNames: string[]
  /**
   * Lazy: keep workbook around so we can switch sheets without re-fetching.
   * Typed as `unknown` to avoid eagerly importing sheetjs types.
   */
  workbook: unknown
}

function inferKind(path: string): 'csv' | 'tsv' | 'xlsx' | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv') return 'tsv'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  return null
}

export function isTableFile(path: string): boolean {
  return inferKind(path) !== null
}

/** Synthetic header labels (A, B, ..., Z, AA, AB, ...) when source lacks them. */
function synthHeaders(cols: number): string[] {
  const result: string[] = []
  for (let i = 0; i < cols; i++) {
    let n = i
    let label = ''
    do {
      label = String.fromCharCode(65 + (n % 26)) + label
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    result.push(label)
  }
  return result
}

function rowsToTable(rows: string[][], originalCount: number): ParsedTable {
  if (rows.length === 0) {
    return { headers: [], rows: [], totalRows: originalCount, truncated: false }
  }
  const colCount = Math.max(...rows.map(r => r.length))
  const truncated = originalCount > ROW_LIMIT
  // Treat first row as header when every cell is non-empty AND total row
  // count > 1 (otherwise a single-row CSV would lose its only line).
  const first = rows[0]!
  const hasHeader = rows.length > 1 && first.length > 0 && first.every(c => c.trim().length > 0)
  const headers = hasHeader ? padCells(first, colCount) : synthHeaders(colCount)
  const body = (hasHeader ? rows.slice(1) : rows).map(r => padCells(r, colCount))
  return { headers, rows: body, totalRows: originalCount, truncated }
}

function padCells(row: string[], len: number): string[] {
  if (row.length >= len) return row
  const out = row.slice()
  while (out.length < len) out.push('')
  return out
}

export function TableViewer({
  file,
  rawFileUrl,
}: {
  file: FileContent
  /** Absolute URL to fetch raw bytes; required for xlsx, ignored for csv/tsv. */
  rawFileUrl?: string
}) {
  const { t } = useTranslation()
  const kind = inferKind(file.path)
  const [parsed, setParsed] = useState<ParsedTable | null>(null)
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Initial parse for csv/tsv from `file.content`; for xlsx fetch raw bytes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setParsed(null)
    setWorkbook(null)
    setActiveSheet(null)

    async function load() {
      try {
        if (kind === 'csv' || kind === 'tsv') {
          const Papa = (await import('papaparse')).default
          if (cancelled) return
          const result = Papa.parse<string[]>(file.content ?? '', {
            delimiter: kind === 'tsv' ? '\t' : '',
            skipEmptyLines: 'greedy',
          })
          const allRows = result.data
          const sliced = allRows.slice(0, ROW_LIMIT)
          if (cancelled) return
          setParsed(rowsToTable(sliced, allRows.length))
          setLoading(false)
          return
        }

        if (kind === 'xlsx') {
          if (!rawFileUrl) {
            setError(t('fileBrowser.tableParseError'))
            setLoading(false)
            return
          }
          const [{ read, utils }, response] = await Promise.all([
            import('xlsx'),
            fetch(rawFileUrl),
          ])
          if (cancelled) return
          if (!response.ok) {
            setError(t('fileBrowser.tableParseError'))
            setLoading(false)
            return
          }
          const bytes = await response.arrayBuffer()
          if (cancelled) return
          const wb = read(bytes, { type: 'array' })
          const sheetNames = wb.SheetNames as string[]
          setWorkbook({ sheetNames, workbook: wb })
          const initialSheet = sheetNames[0] ?? null
          setActiveSheet(initialSheet)
          if (initialSheet) {
            const sheet = wb.Sheets[initialSheet]
            const rows = utils.sheet_to_json<string[]>(sheet, {
              header: 1,
              defval: '',
              blankrows: false,
              raw: false,
            })
            const sliced = rows.slice(0, ROW_LIMIT)
            setParsed(rowsToTable(sliced, rows.length))
          }
          setLoading(false)
        }
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message || t('fileBrowser.tableParseError'))
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [file.content, file.path, kind, rawFileUrl, t])

  // Sheet switch: re-parse from the existing workbook without re-fetching.
  useEffect(() => {
    if (!workbook || !activeSheet) return
    void (async () => {
      const { utils } = await import('xlsx')
      const wb = workbook.workbook as { Sheets: Record<string, unknown> }
      const sheet = wb.Sheets[activeSheet]
      if (!sheet) return
      const rows = utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: false,
      })
      const sliced = rows.slice(0, ROW_LIMIT)
      setParsed(rowsToTable(sliced, rows.length))
    })()
  }, [activeSheet, workbook])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        {t('fileBrowser.tableLoading')}
      </div>
    )
  }

  if (error || !parsed) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <FileWarning className="h-10 w-10" />
        <p className="text-sm">{error ?? t('fileBrowser.tableParseError')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {workbook && workbook.sheetNames.length > 1
        ? (
            <div
              className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2 py-1 shrink-0"
              role="tablist"
              aria-label={t('fileBrowser.tableSheets')}
            >
              {workbook.sheetNames.map(name => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={name === activeSheet}
                  onClick={() => setActiveSheet(name)}
                  className={`shrink-0 rounded px-2 py-0.5 text-xs transition-colors ${
                    name === activeSheet
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )
        : null}
      <div className="flex items-center justify-between px-3 py-1 text-[11px] text-muted-foreground border-b border-border bg-muted/20 shrink-0">
        <span>
          {t('fileBrowser.tableRows', { count: parsed.totalRows })}
          {' · '}
          {t('fileBrowser.tableCols', { count: parsed.headers.length })}
        </span>
        {parsed.truncated
          ? (
              <span className="text-yellow-600 dark:text-yellow-400">
                {t('fileBrowser.tableTruncated', { shown: parsed.rows.length, total: parsed.totalRows })}
              </span>
            )
          : null}
      </div>
      <TableBody headers={parsed.headers} rows={parsed.rows} />
    </div>
  )
}

const ROW_HEIGHT = 28

function TableBody({ headers, rows }: { headers: string[], rows: string[][] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const colTemplate = useMemo(
    () => `repeat(${headers.length}, minmax(80px, 1fr))`,
    [headers.length],
  )

  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
      <div className="min-w-full">
        <div
          className="sticky top-0 z-10 grid bg-muted/60 border-b border-border text-[11px] font-medium text-muted-foreground"
          style={{ gridTemplateColumns: colTemplate }}
        >
          {headers.map((h, idx) => (
            <div
              key={`${h}-${idx}`}
              className="px-2 py-1 truncate border-r border-border/40 last:border-r-0"
              title={h}
            >
              {h || ' '}
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualRow => (
            <div
              key={virtualRow.key}
              className="grid text-xs hover:bg-muted/40 transition-colors"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: colTemplate,
              }}
            >
              {rows[virtualRow.index]!.map((cell, cIdx) => (
                <div
                  key={cIdx}
                  className="px-2 py-1 truncate border-r border-b border-border/30 last:border-r-0 font-mono"
                  title={cell}
                >
                  {cell || ' '}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

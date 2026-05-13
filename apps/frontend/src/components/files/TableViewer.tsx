import { FileWarning } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileContent } from '@/types/kanban'
import 'react-data-grid/lib/styles.css'
import { DataGrid } from 'react-data-grid'
import type { Column } from 'react-data-grid'
import { useTheme } from '@/hooks/use-theme'

const ROW_LIMIT = 1000

interface ParsedTable {
  headers: string[]
  rows: Record<string, string>[]
  totalRows: number
  truncated: boolean
  colSpans?: Map<number, Map<number, number>> // rowIdx -> colIdx -> span
}

interface ParsedWorkbook {
  sheetNames: string[]
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

export function rowsToTable(rows: string[][], originalCount: number, merges?: Array<{ s: { r: number, c: number }, e: { r: number, c: number } }>): ParsedTable {
  if (rows.length === 0) {
    return { headers: [], rows: [], totalRows: originalCount, truncated: false }
  }
  const colCount = Math.max(...rows.map(r => r.length))
  const truncated = originalCount > ROW_LIMIT

  const first = rows[0]!
  const hasHeader = rows.length > 1 && first.length > 0 && first.every(c => c.trim().length > 0)

  let headers: string[]
  let body: string[][]

  if (hasHeader) {
    headers = first.slice()
    body = rows.slice(1)
  } else {
    headers = Array.from({ length: colCount }, (_, i) => String(i + 1))
    body = rows
  }

  // Pad headers
  while (headers.length < colCount) headers.push('')

  // Build colSpan map from xlsx merges
  const colSpans = new Map<number, Map<number, number>>()
  if (merges) {
    for (const m of merges) {
      const { s, e } = m
      const startRow = hasHeader ? s.r - 1 : s.r
      const endRow = hasHeader ? e.r - 1 : e.r
      if (startRow < 0) continue
      const span = e.c - s.c + 1
      if (span > 1) {
        for (let r = startRow; r <= endRow; r++) {
          if (!colSpans.has(r)) colSpans.set(r, new Map())
          colSpans.get(r)!.set(s.c, span)
        }
      }
    }
  }

  // Convert to object rows
  const objectRows: Record<string, string>[] = body.map((row, rowIdx) => {
    const obj: Record<string, string> = {}
    for (let c = 0; c < colCount; c++) {
      const key = headers[c] || `col_${c}`
      obj[key] = row[c] ?? ''
    }
    // Store colSpan info using a special key pattern
    const rowSpans = colSpans.get(rowIdx)
    if (rowSpans) {
      for (const [colIdx, span] of rowSpans) {
        obj[`__span_${colIdx}`] = String(span)
      }
    }
    return obj
  })

  return { headers, rows: objectRows, totalRows: originalCount, truncated, colSpans }
}

export function TableViewer({
  file,
  rawFileUrl,
}: {
  file: FileContent
  rawFileUrl?: string
}) {
  const { t } = useTranslation()
  const { resolved: theme } = useTheme()
  const kind = inferKind(file.path)
  const [parsed, setParsed] = useState<ParsedTable | null>(null)
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
            const merges = sheet['!merges'] as Array<{ s: { r: number, c: number }, e: { r: number, c: number } }> | undefined
            const sliced = rows.slice(0, ROW_LIMIT)
            setParsed(rowsToTable(sliced, rows.length, merges))
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
      const merges = (sheet as Record<string, unknown>)['!merges'] as Array<{ s: { r: number, c: number }, e: { r: number, c: number } }> | undefined
      const sliced = rows.slice(0, ROW_LIMIT)
      setParsed(rowsToTable(sliced, rows.length, merges))
    })()
  }, [activeSheet, workbook])

  const columns = useMemo((): Column<Record<string, string>>[] => {
    if (!parsed) return []
    return parsed.headers.map((header, colIdx) => ({
      key: header || `col_${colIdx}`,
      name: header || '',
      resizable: true,
      minWidth: 60,
      colSpan: (args) => {
        if (args.type !== 'ROW') return undefined
        const spanKey = `__span_${colIdx}`
        const span = args.row[spanKey]
        return span ? Number(span) : undefined
      },
      renderCell: ({ row }) => {
        const key = header || `col_${colIdx}`
        // Skip rendering if this cell is covered by a previous colSpan
        for (let c = 0; c < colIdx; c++) {
          const prevKey = `__span_${c}`
          const prevSpan = row[prevKey]
          if (prevSpan && colIdx < c + Number(prevSpan)) {
            return null
          }
        }
        return row[key] || ''
      },
    }))
  }, [parsed])

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
      <div className="flex-1 min-h-0">
        <DataGrid
          columns={columns}
          rows={parsed.rows}
          rowHeight={28}
          headerRowHeight={32}
          className={`h-full ${theme === 'dark' ? 'rdg-dark' : 'rdg-light'}`}
          enableVirtualization
        />
      </div>
    </div>
  )
}

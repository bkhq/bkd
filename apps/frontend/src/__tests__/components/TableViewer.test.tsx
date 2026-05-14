import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rowsToTable, TableViewer, isTableFile } from '../../components/files/TableViewer'
import type { FileContent } from '../../types/kanban'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../hooks/use-theme', () => ({
  useTheme: () => ({ resolved: 'light' }),
}))

vi.mock('react-data-grid', () => ({
  DataGrid: ({ columns, rows, className }: { columns: unknown[], rows: unknown[], className?: string }) => (
    <div data-testid="data-grid" data-columns={columns.length} data-rows={rows.length} className={className}>
      Grid
    </div>
  ),
}))

describe('isTableFile', () => {
  it('recognizes csv', () => {
    expect(isTableFile('data.csv')).toBe(true)
  })

  it('recognizes tsv', () => {
    expect(isTableFile('data.tsv')).toBe(true)
  })

  it('recognizes xlsx', () => {
    expect(isTableFile('data.xlsx')).toBe(true)
  })

  it('recognizes xls', () => {
    expect(isTableFile('data.xls')).toBe(true)
  })

  it('rejects other extensions', () => {
    expect(isTableFile('data.txt')).toBe(false)
    expect(isTableFile('data.json')).toBe(false)
    expect(isTableFile('data')).toBe(false)
  })
})

describe('rowsToTable', () => {
  it('returns empty for empty input', () => {
    const result = rowsToTable([], 0)
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
    expect(result.totalRows).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('uses first row as header when multiple rows exist', () => {
    const result = rowsToTable([
      ['Name', 'Age', 'City'],
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ], 3)
    expect(result.headers).toEqual(['Name', 'Age', 'City'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ Name: 'Alice', Age: '30', City: 'NYC' })
  })

  it('generates numeric headers when single row', () => {
    const result = rowsToTable([['Alice', '30', 'NYC']], 1)
    expect(result.headers).toEqual(['1', '2', '3'])
    expect(result.rows).toHaveLength(1)
  })

  it('generates numeric headers when header row is empty', () => {
    const result = rowsToTable([
      ['', '', ''],
      ['Alice', '30', 'NYC'],
    ], 2)
    expect(result.headers).toEqual(['1', '2', '3'])
  })

  it('pads headers to match column count', () => {
    const result = rowsToTable([
      ['Name'],
      ['Alice', '30', 'NYC'],
    ], 2)
    expect(result.headers).toEqual(['Name', '', ''])
    expect(result.rows[0]).toHaveProperty('Name')
    expect(result.rows[0]).toHaveProperty('col_1')
    expect(result.rows[0]).toHaveProperty('col_2')
  })

  it('marks truncated when over limit', () => {
    const result = rowsToTable([['A'], ['B']], 2000)
    expect(result.truncated).toBe(true)
  })

  it('handles merged cells (colSpan)', () => {
    const result = rowsToTable([
      ['Header1', 'Header2', 'Header3'],
      ['Merged', 'Cell2', 'Cell3'],
    ], 2, [{ s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }])

    expect(result.headers).toEqual(['Header1', 'Header2', 'Header3'])
    expect(result.rows[0]).toMatchObject({
      Header1: 'Merged',
      Header2: 'Cell2',
      Header3: 'Cell3',
      '__span_0': '3',
    })
  })

  it('ignores merges in header row', () => {
    const result = rowsToTable([
      ['Merged', 'Header2', 'Header3'],
      ['Alice', '30', 'NYC'],
    ], 2, [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }])

    // Header row merge should not affect data rows
    expect(result.rows[0]).not.toHaveProperty('__span_0')
  })
})

describe('TableViewer CSV rendering', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders CSV content via DataGrid', async () => {
    vi.doMock('papaparse', () => ({
      default: {
        parse: () => ({
          data: [
            ['Name', 'Age'],
            ['Alice', '30'],
            ['Bob', '25'],
          ],
        }),
      },
    }))

    const file: FileContent = {
      path: 'data.csv',
      content: 'Name,Age\nAlice,30\nBob,25',
      type: 'file',
      size: 100,
      isTruncated: false,
      isBinary: false,
    }

    render(<TableViewer file={file} />)

    await waitFor(() => {
      expect(screen.getByTestId('data-grid')).toBeDefined()
    })

    const grid = screen.getByTestId('data-grid')
    expect(grid.getAttribute('data-columns')).toBe('2')
    expect(grid.getAttribute('data-rows')).toBe('2')
  })
})

describe('TableViewer error states', () => {
  it('shows loading state initially', () => {
    const file: FileContent = {
      path: 'data.csv',
      content: '',
      type: 'file',
      size: 0,
      isTruncated: false,
      isBinary: false,
    }

    render(<TableViewer file={file} />)
    expect(screen.getByText('fileBrowser.tableLoading')).toBeDefined()
  })

  it('shows error for xlsx without rawFileUrl', async () => {
    const file: FileContent = {
      path: 'data.xlsx',
      content: '',
      type: 'file',
      size: 0,
      isTruncated: false,
      isBinary: false,
    }

    render(<TableViewer file={file} />)

    await waitFor(() => {
      expect(screen.getByText('fileBrowser.tableParseError')).toBeDefined()
    })
  })
})

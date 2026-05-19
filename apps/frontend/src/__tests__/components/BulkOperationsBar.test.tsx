import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BulkOperationsBar } from '@/components/issue-detail/BulkOperationsBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const runMock = vi.fn().mockResolvedValue({ done: 1, failed: 0 })
const clearMock = vi.fn()

vi.mock('@/hooks/use-bulk-operations', () => ({
  useBulkOperations: () => ({ run: runMock, progress: null, isRunning: false }),
}))

vi.mock('@/stores/bulk-selection-store', () => ({
  useBulkSelectionStore: (selector: any) => selector({ clear: clearMock }),
}))

describe('bulkOperationsBar', () => {
  beforeEach(() => {
    runMock.mockReset()
    runMock.mockResolvedValue({ done: 1, failed: 0 })
    clearMock.mockReset()
  })

  it('renders nothing when no items', () => {
    const { container } = render(<BulkOperationsBar items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders selected count + action buttons when items present', () => {
    render(<BulkOperationsBar items={[{ issueId: 'i1', projectId: 'p1' }, { issueId: 'i2', projectId: 'p1' }]} />)
    expect(screen.getByText('2')).toBeDefined()
    expect(screen.getByTestId('bulk-restart')).toBeDefined()
    expect(screen.getByTestId('bulk-cancel')).toBeDefined()
    expect(screen.getByTestId('bulk-move')).toBeDefined()
  })

  it('clicking Restart calls run("restart", items)', () => {
    const items = [{ issueId: 'i1', projectId: 'p1' }]
    render(<BulkOperationsBar items={items} />)
    fireEvent.click(screen.getByTestId('bulk-restart'))
    expect(runMock).toHaveBeenCalledWith('restart', items)
  })

  it('clicking Cancel calls run("cancel", items)', () => {
    const items = [{ issueId: 'i1', projectId: 'p1' }]
    render(<BulkOperationsBar items={items} />)
    fireEvent.click(screen.getByTestId('bulk-cancel'))
    expect(runMock).toHaveBeenCalledWith('cancel', items)
  })
})

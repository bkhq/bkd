import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { CronJob } from '@/lib/kanban-api'
import CronPage from '@/pages/CronPage'

const mocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  deleteReset: vi.fn(),
  cleanupMutate: vi.fn(),
  cleanupReset: vi.fn(),
  toastSuccess: vi.fn(),
}))

const job: CronJob = {
  id: 'cron-1',
  name: 'cleanup',
  cron: '0 0 * * * *',
  taskType: 'builtin',
  taskConfig: { action: 'cleanup' },
  enabled: true,
  status: 'scheduled',
  nextExecution: null,
  lastRun: null,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

vi.mock('@/components/kanban/AppSidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/kanban/MobileSidebar', () => ({ MobileSidebar: () => null }))
vi.mock('@/hooks/use-kanban', () => ({
  useCronJobs: () => ({ data: [job], isLoading: false }),
  useDeleteCronJob: () => ({
    mutate: mocks.deleteMutate,
    reset: mocks.deleteReset,
    isPending: false,
    error: null,
  }),
  useCleanupCronHistory: () => ({
    mutate: mocks.cleanupMutate,
    reset: mocks.cleanupReset,
    isPending: false,
    error: null,
  }),
  usePauseCronJob: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeCronJob: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolved: 'light' }),
}))

describe('cron page deletion', () => {
  beforeEach(async () => {
    mocks.deleteMutate.mockReset()
    mocks.deleteReset.mockReset()
    await i18n.changeLanguage('en')
  })

  it('confirms before deleting an active cron job', () => {
    render(
      <MemoryRouter>
        <CronPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Delete cron job?')).toBeInTheDocument()
    expect(within(dialog).getByText(/cleanup/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteMutate).toHaveBeenCalledWith(
      'cron-1',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })
})

describe('cron page history cleanup', () => {
  beforeEach(async () => {
    mocks.cleanupMutate.mockReset()
    mocks.cleanupReset.mockReset()
    mocks.toastSuccess.mockReset()
    await i18n.changeLanguage('en')
  })

  it('confirms before cleaning the history and reports what was removed', () => {
    render(
      <MemoryRouter>
        <CronPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clean up history' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Clean up cron history?')).toBeInTheDocument()
    expect(mocks.cleanupMutate).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clean up' }))

    expect(mocks.cleanupMutate).toHaveBeenCalledTimes(1)
    const [, options] = mocks.cleanupMutate.mock.calls[0]!
    options.onSuccess({ jobsDeleted: 2, logsDeleted: 30 })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Removed 2 deleted jobs and 30 log entries')
  })
})

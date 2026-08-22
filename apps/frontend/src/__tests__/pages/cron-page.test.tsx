import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { CronJob } from '@/lib/kanban-api'
import CronPage from '@/pages/CronPage'

const mocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  deleteReset: vi.fn(),
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
  isDeleted: false,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

vi.mock('@/hooks/use-kanban', () => ({
  useCronJobs: () => ({ data: [job], isLoading: false }),
  useDeleteCronJob: () => ({
    mutate: mocks.deleteMutate,
    reset: mocks.deleteReset,
    isPending: false,
    error: null,
  }),
  usePauseCronJob: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeCronJob: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolved: 'light' }),
}))

describe('cron page deletion', () => {
  beforeEach(async () => {
    mocks.deleteMutate.mockReset()
    mocks.deleteReset.mockReset()
    job.isDeleted = false
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

  it('does not offer deletion for an already deleted cron job', () => {
    job.isDeleted = true

    render(
      <MemoryRouter>
        <CronPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Deleted Jobs/ }))
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})

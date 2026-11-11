import type { EngineUpdate } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineUpdateButton } from '@/components/settings/EngineUpdate'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  update: undefined as EngineUpdate | undefined,
}))

vi.mock('@/hooks/use-kanban', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/use-kanban')>(),
  useStartEngineUpdate: () => ({ mutate: mocks.start, isPending: false }),
  useEngineUpdate: () => ({ data: mocks.update }),
}))

function update(patch: Partial<EngineUpdate>): EngineUpdate {
  return {
    id: 'u1',
    engineType: 'claude-code',
    status: 'running',
    output: [],
    error: null,
    fromVersion: '2.1.300',
    toVersion: null,
    startedAt: '2026-11-10T12:00:00Z',
    finishedAt: null,
    ...patch,
  }
}

describe('engine update', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.start.mockReset()
    mocks.update = undefined
  })

  it('starts the engine\'s update', () => {
    render(<EngineUpdateButton engineType="claude-code" name="Claude Code" />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(mocks.start).toHaveBeenCalledWith('claude-code', expect.anything())
  })

  it('shows the output and the new version when it succeeds', () => {
    mocks.start.mockImplementation((_type: string, { onSuccess }: { onSuccess: (u: EngineUpdate) => void }) => onSuccess(update({})))
    mocks.update = update({ status: 'succeeded', toVersion: '2.1.322', output: ['Successfully updated'] })
    render(<EngineUpdateButton engineType="claude-code" name="Claude Code" />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(screen.getByText('v2.1.300 → v2.1.322')).toBeInTheDocument()
    expect(screen.getByText(/Successfully updated/)).toBeInTheDocument()
    // The output scrolls in the ScrollArea base component
    expect(screen.getByText(/Successfully updated/).closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
  })

  it('shows the error when it fails', () => {
    mocks.start.mockImplementation((_type: string, { onSuccess }: { onSuccess: (u: EngineUpdate) => void }) => onSuccess(update({})))
    mocks.update = update({ status: 'failed', error: 'Updater exited with code 1' })
    render(<EngineUpdateButton engineType="claude-code" name="Claude Code" />)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(screen.getByText(/Updater exited with code 1/)).toBeInTheDocument()
  })
})

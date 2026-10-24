import type { UpgradeStatus } from '@bkd/shared'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpgradeSection } from '@/components/AppSettingsDialog'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({
  status: {} as Partial<UpgradeStatus>,
  lode: { version: '0.3.0', commit: '0123456789ab' } as { version: string, commit: string | null } | null,
}))

vi.mock('@/hooks/use-kanban', async (importOriginal) => {
  const mutation = { mutate: vi.fn(), isPending: false }
  return {
    ...await importOriginal<typeof import('@/hooks/use-kanban')>(),
    useVersionInfo: () => ({ data: { version: '0.3.27', commit: 'abc', supervised: true, activeVersion: '0.3.27', lode: mocks.lode } }),
    useUpgradeStatus: () => ({ data: { supervised: true, current: '0.3.27', history: [], ...mocks.status } }),
    useCheckUpgrade: () => mutation,
    useRequestUpgrade: () => mutation,
    useRequestRollback: () => mutation,
    useRestartServer: () => mutation,
  }
})

describe('upgrade section', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.status = {}
    mocks.lode = { version: '0.3.0', commit: '0123456789ab' }
  })

  it('shows the supervising lode version, with its commit on hover', () => {
    render(<UpgradeSection open />)
    expect(screen.getByText('lode v0.3.0')).toHaveAttribute('title', '0123456789ab')
  })

  it('falls back to a bare lode badge for a lode that does not report its version', () => {
    mocks.lode = null
    render(<UpgradeSection open />)
    expect(screen.getByText('lode')).toBeInTheDocument()
  })

  it('says up to date and offers no update, hiding lode\'s failure notes', () => {
    mocks.status = {
      status: 'running',
      lastError: 'update check: manifest: release "0.3.27" has no assets',
      checkError: 'manifest: release "0.3.27" has no assets',
    }
    render(<UpgradeSection open />)
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.queryByText(/has no assets/)).not.toBeInTheDocument()
    expect(screen.queryByText('running')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Update/ })).not.toBeInTheDocument()
  })

  it('offers the update when a newer version is available', () => {
    mocks.status = { available: '0.3.28', hasUpdate: true, lastError: 'boom' }
    render(<UpgradeSection open />)
    expect(screen.getByText(/0\.3\.28/)).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Update/ })).toBeInTheDocument()
  })
})

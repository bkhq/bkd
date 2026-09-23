import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useServerStore } from '@/stores/server-store'

const projects = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
]

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/hooks/use-kanban', () => ({ useProjects: () => ({ data: projects }) }))
vi.mock('@/hooks/use-event-connection', () => ({ useEventConnection: () => true }))
vi.mock('@/components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }))
vi.mock('@/components/CreateProjectDialog', () => ({ CreateProjectDialog: () => null }))

function openSheet() {
  render(<MobileSidebar activeProjectId="p1" />)
  fireEvent.click(screen.getByLabelText('sidebar.menu'))
}

beforeEach(() => {
  useServerStore.setState({ name: null, url: null })
})

afterEach(() => {
  cleanup()
})

describe('mobileSidebar', () => {
  it('exposes the same global pages as the desktop rail', () => {
    openSheet()

    expect(screen.getByText('viewMode.review')).toBeInTheDocument()
    expect(screen.getByText('cron.title')).toBeInTheDocument()
    expect(screen.getByText('sessions.title')).toBeInTheDocument()
  })

  it('falls back to the BKD brand when no server name is configured', () => {
    openSheet()

    expect(screen.getByText('BKD')).toBeInTheDocument()
    expect(screen.queryByText('BitK')).not.toBeInTheDocument()
  })

  it('shows the configured server name in the header', () => {
    useServerStore.setState({ name: 'Bench', url: null })
    openSheet()

    expect(screen.getByText('Bench')).toBeInTheDocument()
    expect(screen.queryByText('BKD')).not.toBeInTheDocument()
  })
})

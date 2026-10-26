import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useMessagesStore } from '@/stores/messages-store'
import { useServerStore } from '@/stores/server-store'

const mocks = vi.hoisted(() => ({ waitingMessages: 0, pathname: '/' }))

const projects = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
]

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: mocks.pathname }) }))
vi.mock('@/hooks/use-kanban', () => ({ useProjects: () => ({ data: projects }) }))
vi.mock('@/hooks/use-messages', () => ({ useWaitingMessageCount: () => mocks.waitingMessages }))
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
  mocks.waitingMessages = 0
  mocks.pathname = '/'
})

describe('mobileSidebar', () => {
  it('exposes the same global pages as the desktop rail', () => {
    openSheet()

    expect(screen.getByText('viewMode.review')).toBeInTheDocument()
    expect(screen.getByText('cron.title')).toBeInTheDocument()
    expect(screen.getByText('sessions.title')).toBeInTheDocument()
  })

  it('marks the page being viewed as current', () => {
    mocks.pathname = '/skills'
    openSheet()

    expect(screen.getByText('skills.title').closest('button')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('cron.title').closest('button')).not.toHaveAttribute('aria-current')
  })

  it('closes from a single close button in the header row', async () => {
    openSheet()

    // The sheet's own absolutely-placed close button is replaced, so there is only one
    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'sidebar.closeMenu' }))
    await waitFor(() => expect(screen.queryByText('cron.title')).toBeNull())
  })

  it('shows how many messages are waiting', () => {
    mocks.waitingMessages = 2
    openSheet()

    expect(screen.getByText('messages.title').closest('button')).toHaveTextContent('2')
  })

  it('opens the messages drawer fullscreen', () => {
    useMessagesStore.setState({ isOpen: false, isFullscreen: false })
    openSheet()

    fireEvent.click(screen.getByText('messages.title'))

    expect(useMessagesStore.getState()).toMatchObject({ isOpen: true, isFullscreen: true })
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

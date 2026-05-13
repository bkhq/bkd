import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewModeStore } from '../../stores/view-mode-store'

// ── Mocks must be defined before importing the component ────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('../../hooks/use-event-connection', () => ({
  useEventConnection: () => true,
}))

vi.mock('../../hooks/use-kanban', () => ({
  useProjects: () => ({ data: [] }),
}))

vi.mock('../../components/CreateProjectDialog', () => ({
  CreateProjectDialog: () => null,
}))

vi.mock('../../components/AppSettingsDialog', () => ({
  AppSettingsDialog: () => null,
}))

import { AppSidebar } from '../../components/kanban/AppSidebar'

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AppSidebar collapse/expand', () => {
  beforeEach(() => {
    // Reset store to expanded before each test
    useViewModeStore.setState({ sidebarCollapsed: false })
  })

  it('renders full sidebar when expanded', () => {
    render(<Wrapper><AppSidebar activeProjectId="" /></Wrapper>)

    // The home button should be visible
    expect(screen.getByLabelText('sidebar.home')).toBeDefined()
    // The collapse button should be visible
    expect(screen.getByLabelText('sidebar.collapse')).toBeDefined()
  })

  it('renders collapsed strip when collapsed', () => {
    useViewModeStore.setState({ sidebarCollapsed: true })

    const { container } = render(<Wrapper><AppSidebar activeProjectId="" /></Wrapper>)

    // The expand button should be in the DOM (inside the collapsed strip)
    expect(screen.getByLabelText('sidebar.expand')).toBeDefined()
    // The home button should NOT be in the DOM
    expect(screen.queryByLabelText('sidebar.home')).toBeNull()
    // The collapsed strip should have the narrow width style
    const strip = container.firstChild as HTMLElement
    expect(strip).toBeDefined()
    expect(strip.style.width).toBe('8px')
  })

  it('clicking collapse button toggles the store', () => {
    render(<Wrapper><AppSidebar activeProjectId="" /></Wrapper>)

    const collapseBtn = screen.getByLabelText('sidebar.collapse')
    fireEvent.click(collapseBtn)

    expect(useViewModeStore.getState().sidebarCollapsed).toBe(true)
  })
})

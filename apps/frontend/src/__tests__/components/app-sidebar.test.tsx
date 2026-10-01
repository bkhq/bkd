import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from '@/components/kanban/AppSidebar'

const projects = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
  { id: 'p3', name: 'Gamma' },
]

const navigate = vi.fn()

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('@/hooks/use-kanban', () => ({ useProjects: () => ({ data: projects }) }))
vi.mock('@/hooks/use-event-connection', () => ({ useEventConnection: () => true }))
vi.mock('@/components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }))
vi.mock('@/components/CreateProjectDialog', () => ({ CreateProjectDialog: () => null }))
vi.mock('@/components/ViewModeSelect', () => ({ ViewModeSelect: () => null }))

const scrollIntoView = vi.fn()

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  cleanup()
  scrollIntoView.mockClear()
  navigate.mockClear()
})

describe('appSidebar project rail', () => {
  it('centers the rail on the active project', () => {
    const { getByLabelText } = render(<AppSidebar activeProjectId="p3" />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(getByLabelText('Gamma'))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('re-centers when the active project changes', () => {
    const { rerender, getByLabelText } = render(<AppSidebar activeProjectId="p1" />)
    scrollIntoView.mockClear()

    rerender(<AppSidebar activeProjectId="p2" />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(getByLabelText('Beta'))
  })

  it('does not scroll when no project is active', () => {
    render(<AppSidebar activeProjectId="" />)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('appSidebar project flyout', () => {
  it('stays closed until the project area is hovered', () => {
    const { queryByTestId } = render(<AppSidebar activeProjectId="p1" />)

    expect(queryByTestId('project-flyout')).toBeNull()
  })

  it('lists every project by full name on hover', () => {
    const { getByTestId } = render(<AppSidebar activeProjectId="p1" />)

    fireEvent.mouseEnter(getByTestId('project-rail'))

    const flyout = getByTestId('project-flyout')
    for (const project of projects) {
      expect(flyout).toHaveTextContent(project.name)
    }
  })

  it('lists names only, without the initials badge', () => {
    const { getByTestId, getByRole } = render(<AppSidebar activeProjectId="p1" />)
    fireEvent.mouseEnter(getByTestId('project-rail'))

    // A row is just the project name; the rail buttons keep the initials.
    expect(getByRole('menuitem', { name: 'Alpha' }).textContent).toBe('Alpha')
  })

  it('navigates when a flyout row is clicked', () => {
    const { getByTestId, getByRole } = render(<AppSidebar activeProjectId="p1" />)
    fireEvent.mouseEnter(getByTestId('project-rail'))

    fireEvent.click(getByRole('menuitem', { name: 'Gamma' }))

    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('marks the active project in the flyout', () => {
    const { getByTestId, getByRole } = render(<AppSidebar activeProjectId="p2" />)

    fireEvent.mouseEnter(getByTestId('project-rail'))

    expect(getByRole('menuitem', { name: 'Beta' })).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the flyout open while the pointer crosses into it', () => {
    vi.useFakeTimers()
    try {
      const { getByTestId, queryByTestId } = render(<AppSidebar activeProjectId="p1" />)
      fireEvent.mouseEnter(getByTestId('project-rail'))

      // Crossing the gap fires leave on the rail before enter on the flyout.
      fireEvent.mouseLeave(getByTestId('project-rail'))
      fireEvent.mouseEnter(getByTestId('project-flyout'))
      act(() => void vi.advanceTimersByTime(500))

      expect(queryByTestId('project-flyout')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes shortly after the pointer leaves', () => {
    vi.useFakeTimers()
    try {
      const { getByTestId, queryByTestId } = render(<AppSidebar activeProjectId="p1" />)
      fireEvent.mouseEnter(getByTestId('project-rail'))

      fireEvent.mouseLeave(getByTestId('project-rail'))
      act(() => void vi.advanceTimersByTime(500))

      expect(queryByTestId('project-flyout')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('appSidebar global pages', () => {
  it('links to review, cron and local sessions', () => {
    const { getByLabelText } = render(<AppSidebar activeProjectId="" />)

    expect(getByLabelText('viewMode.review')).toBeInTheDocument()
    expect(getByLabelText('cron.title')).toBeInTheDocument()
    expect(getByLabelText('sessions.title')).toBeInTheDocument()
  })
})

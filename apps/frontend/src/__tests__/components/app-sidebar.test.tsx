import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from '@/components/kanban/AppSidebar'

const projects = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
  { id: 'p3', name: 'Gamma' },
]

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
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

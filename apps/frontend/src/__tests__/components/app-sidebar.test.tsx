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

// jsdom has no layout, so give the flyout fixed geometry: rows are 44px tall
// inside 4px of padding and a 1px border.
const ROW_HEIGHT = 44
const PADDING = 4
const BORDER = 1

function mockFlyoutLayout() {
  const rowIndex = (el: HTMLElement) =>
    Array.from(el.parentElement?.children ?? []).indexOf(el)
  const isRow = (el: HTMLElement) => el.getAttribute('role') === 'menuitem'
  const isFlyout = (el: HTMLElement) => el.dataset.testid === 'project-flyout'
  const define = (prop: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this)
      },
    })

  define('offsetTop', el => (isRow(el) ? PADDING + rowIndex(el) * ROW_HEIGHT : 0))
  define('offsetHeight', el =>
    isRow(el) ? ROW_HEIGHT : isFlyout(el) ? el.children.length * ROW_HEIGHT + 2 * (PADDING + BORDER) : 0)
  define('clientHeight', el =>
    isFlyout(el) ? el.children.length * ROW_HEIGHT + 2 * PADDING : 0)
  define('scrollHeight', el =>
    isFlyout(el) ? el.children.length * ROW_HEIGHT + 2 * PADDING : 0)
  define('clientTop', el => (isFlyout(el) ? BORDER : 0))
}

function restoreFlyoutLayout() {
  for (const prop of ['offsetTop', 'offsetHeight', 'clientHeight', 'scrollHeight', 'clientTop']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
  }
}

function placeAt(el: HTMLElement, top: number, height = 36) {
  el.getBoundingClientRect = () =>
    ({ top, height, bottom: top + height, left: 10, right: 46, width: 36, x: 10, y: top, toJSON: () => ({}) })
}

describe('appSidebar project flyout', () => {
  beforeEach(mockFlyoutLayout)
  afterEach(restoreFlyoutLayout)

  it('stays closed until a project icon is hovered', () => {
    const { queryByTestId } = render(<AppSidebar activeProjectId="p1" />)

    expect(queryByTestId('project-flyout')).toBeNull()
  })

  it('lists every project by full name on hover', () => {
    const { getByTestId, getByLabelText } = render(<AppSidebar activeProjectId="p1" />)

    fireEvent.mouseEnter(getByLabelText('Alpha'))

    const flyout = getByTestId('project-flyout')
    for (const project of projects) {
      expect(flyout).toHaveTextContent(project.name)
    }
  })

  it('shows the project icon next to each name', () => {
    const { getByLabelText, getByRole } = render(<AppSidebar activeProjectId="p1" />)
    fireEvent.mouseEnter(getByLabelText('Alpha'))

    // Same two-letter initials the rail buttons show, followed by the name.
    expect(getByRole('menuitem', { name: 'Alpha' }).textContent).toBe('ALAlpha')
  })

  it('levels the hovered project row with its rail icon', () => {
    const { getByTestId, getByLabelText } = render(<AppSidebar activeProjectId="p1" />)
    const gamma = getByLabelText('Gamma')
    placeAt(gamma, 300)

    fireEvent.mouseEnter(gamma)

    // Icon centre 318. Gamma is the third row: 4 padding + 2 * 44 above it, plus
    // the 1px border and half a row (22) => its centre is 115px below the top.
    expect(getByTestId('project-flyout').style.top).toBe(`${318 - 115}px`)
  })

  it('follows the pointer from one icon to the next', () => {
    const { getByTestId, getByLabelText } = render(<AppSidebar activeProjectId="p1" />)
    const alpha = getByLabelText('Alpha')
    const gamma = getByLabelText('Gamma')
    placeAt(alpha, 100)
    placeAt(gamma, 300)

    fireEvent.mouseEnter(alpha)
    expect(getByTestId('project-flyout').style.top).toBe(`${118 - 27}px`)

    fireEvent.mouseLeave(alpha)
    fireEvent.mouseEnter(gamma)
    expect(getByTestId('project-flyout').style.top).toBe(`${318 - 115}px`)
  })

  it('marks the row that belongs to the hovered icon', () => {
    const { getByLabelText, getByRole } = render(<AppSidebar activeProjectId="p1" />)

    fireEvent.mouseEnter(getByLabelText('Beta'))

    expect(getByRole('menuitem', { name: 'Beta' })).toHaveAttribute('data-anchor', 'true')
    expect(getByRole('menuitem', { name: 'Alpha' })).not.toHaveAttribute('data-anchor')
  })

  it('navigates when a flyout row is clicked', () => {
    const { getByLabelText, getByRole } = render(<AppSidebar activeProjectId="p1" />)
    fireEvent.mouseEnter(getByLabelText('Alpha'))

    fireEvent.click(getByRole('menuitem', { name: 'Gamma' }))

    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('marks the active project in the flyout', () => {
    const { getByLabelText, getByRole } = render(<AppSidebar activeProjectId="p2" />)

    fireEvent.mouseEnter(getByLabelText('Alpha'))

    expect(getByRole('menuitem', { name: 'Beta' })).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the flyout open while the pointer crosses into it', () => {
    vi.useFakeTimers()
    try {
      const { getByTestId, getByLabelText, queryByTestId } = render(<AppSidebar activeProjectId="p1" />)
      const alpha = getByLabelText('Alpha')
      fireEvent.mouseEnter(alpha)

      // Crossing the gap fires leave on the icon before enter on the flyout.
      fireEvent.mouseLeave(alpha)
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
      const { getByLabelText, queryByTestId } = render(<AppSidebar activeProjectId="p1" />)
      const alpha = getByLabelText('Alpha')
      fireEvent.mouseEnter(alpha)

      fireEvent.mouseLeave(alpha)
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

import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRecentIssue,
  clearRecentIssues,
} from '@/hooks/use-recent-issues'

import { RecentTabs } from '@/components/cockpit/RecentTabs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const openCreateMock = vi.fn()
vi.mock('@/stores/panel-store', () => ({
  usePanelStore: (selector: (s: { openCreateDialog: () => void }) => unknown) =>
    selector({ openCreateDialog: openCreateMock }),
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

function Wrap({
  children,
  initialPath = '/review',
}: { children: React.ReactNode, initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/review" element={children} />
        <Route path="/review/:projectAlias/:issueId" element={children} />
      </Routes>
    </MemoryRouter>
  )
}

const seed = (i: number, alias = 'alpha') =>
  addRecentIssue({
    id: `tab-${i}`,
    title: `Issue ${i}`,
    issueNumber: i,
    projectAlias: alias,
    projectName: alias,
    statusId: 'working',
  })

describe('recentTabs', () => {
  beforeEach(() => {
    clearRecentIssues()
    navigateMock.mockReset()
    openCreateMock.mockReset()
  })
  afterEach(() => clearRecentIssues())

  it('renders nothing when no recent issues', () => {
    const { container } = render(<Wrap><RecentTabs /></Wrap>)
    expect(container.firstChild).toBeNull()
  })

  it('renders up to 5 tabs (cap)', () => {
    for (let i = 0; i < 8; i++) seed(i)
    render(<Wrap><RecentTabs /></Wrap>)
    const tabs = screen.getAllByTestId(/^recent-tab-tab-/)
    expect(tabs.length).toBe(5)
  })

  it('clicking a tab navigates to its cockpit URL', () => {
    seed(1)
    render(<Wrap><RecentTabs /></Wrap>)
    fireEvent.click(screen.getByText('Issue 1'))
    expect(navigateMock).toHaveBeenCalledWith('/review/alpha/tab-1')
  })

  it('close × removes the tab from the store without navigating', () => {
    seed(1)
    seed(2)
    render(<Wrap><RecentTabs /></Wrap>)
    expect(screen.getByTestId('recent-tab-tab-1')).toBeDefined()
    act(() => {
      fireEvent.click(screen.getByTestId('recent-tab-close-tab-1'))
    })
    expect(navigateMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recent-tab-tab-1')).toBeNull()
    expect(screen.getByTestId('recent-tab-tab-2')).toBeDefined()
  })

  it('marks the active tab via data-active when URL matches', () => {
    seed(7)
    render(<Wrap initialPath="/review/alpha/tab-7"><RecentTabs /></Wrap>)
    const active = screen.getByTestId('recent-tab-tab-7')
    expect(active.getAttribute('data-active')).toBe('true')
  })

  it('+ button opens the create dialog via panel store', () => {
    seed(1)
    render(<Wrap><RecentTabs /></Wrap>)
    fireEvent.click(screen.getByTestId('recent-tabs-new'))
    expect(openCreateMock).toHaveBeenCalled()
  })
})

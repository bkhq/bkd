/**
 * Page-level integration tests for /review.
 * Not a real browser e2e — uses RTL + jsdom + memory router.
 * Mocks the data layer and AppSidebar; verifies the composition that single-
 * component tests can't see (mobile mode switching, list collapse, ghost strip,
 * cockpit-empty-state).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useViewModeStore } from '@/stores/view-mode-store'

import ReviewPage from '@/pages/ReviewPage'

// ── Mocks (hoisted) ──────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const isMobileMock = vi.fn(() => false)
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => isMobileMock(),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewIssues: () => ({ data: [], isLoading: false }),
  useIssueStats: () => ({
    data: [
      {
        projectId: 'p1',
        projectName: 'Alpha',
        projectAlias: 'alpha',
        counts: { todo: 1, working: 2, review: 0, done: 3 },
        total: 6,
      },
    ],
    isLoading: false,
  }),
  useProjects: () => ({ data: [{ id: 'p1', name: 'Alpha', alias: 'alpha' }] }),
  useReviewReadStatus: () => ({ markAsRead: vi.fn(), isRead: () => true }),
  useIssue: () => ({ data: undefined }),
  useUpdateIssue: () => ({ mutate: vi.fn(), isPending: false }),
  queryKeys: {
    issues: () => ['x'],
    issueStats: () => ['y'],
    reviewIssues: () => ['z'],
    cockpitTimeline: () => ['ct'],
  },
}))

vi.mock('@/hooks/use-issue-templates', () => ({
  useIssueTemplates: () => ({ data: [] }),
}))

vi.mock('@/hooks/use-bulk-operations', () => ({
  useBulkOperations: () => ({ run: vi.fn(), progress: null, isRunning: false }),
}))

vi.mock('@/components/kanban/AppSidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar-stub" />,
}))

vi.mock('@/components/kanban/MobileSidebar', () => ({
  MobileSidebar: () => <div data-testid="mobile-sidebar-stub" />,
}))

vi.mock('@/components/cockpit/AssistantFab', () => ({
  AssistantFab: () => <div data-testid="assistant-fab-stub" />,
}))

vi.mock('@/components/cockpit/ActivityStream', () => ({
  ActivityStream: () => <div data-testid="activity-stream-stub" />,
}))

// Stub the always-on bot timeline (COCKPIT-007). The dashboard now puts
// it ahead of Matrix + ActivityStream as the primary surface; layout
// tests only care that the dashboard mounts, not that the timeline
// renders messages.
vi.mock('@/components/cockpit/BotTimeline', () => ({
  BotTimeline: () => <div data-testid="bot-timeline-stub" />,
}))

// Capture ChatArea props so we can assert hideTitleBar wiring without
// dragging the entire chat stack (ChatBody / ChatInput / useIssueStream
// / file browser store) into the test.
const chatAreaProps = vi.fn()
vi.mock('@/components/issue-detail/ChatArea', () => ({
  ChatArea: (props: Record<string, unknown>) => {
    chatAreaProps(props)
    return <div data-testid="chat-area-stub" />
  },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    onIssueUpdated: () => () => {},
    onCockpitProposal: () => () => {},
    onCockpitTimeline: () => () => {},
  },
}))

function Wrapper({ children, initialPath = '/review' }: { children: ReactNode, initialPath?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/review" element={children} />
          <Route path="/review/:projectAlias/:issueId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('reviewPage integration — desktop, no issue selected', () => {
  beforeEach(() => {
    isMobileMock.mockReturnValue(false)
    useViewModeStore.setState({
      sidebarCollapsed: false,
      listPanelCollapsed: false,
    })
  })

  it('renders sidebar + review list + CockpitDashboard (bot timeline)', () => {
    render(<Wrapper><ReviewPage /></Wrapper>)
    expect(screen.getByTestId('app-sidebar-stub')).toBeDefined()
    // Always-on bot timeline is the primary cockpit surface (COCKPIT-007).
    expect(screen.getByTestId('bot-timeline-stub')).toBeDefined()
    // Matrix + ActivityStream sit behind a lazy "Show raw activity"
    // disclosure and must NOT be mounted on initial render.
    expect(screen.queryByTestId('cockpit-matrix-row-p1')).toBeNull()
    expect(screen.queryByTestId('activity-stream-stub')).toBeNull()
    // AI assistant FAB still present
    expect(screen.getByTestId('assistant-fab-stub')).toBeDefined()
  })

  it('clicking the list-panel collapse button swaps the list for a ghost strip', () => {
    render(<Wrapper><ReviewPage /></Wrapper>)
    // Initially expanded — collapse button visible, ghost absent
    expect(screen.queryByTestId('list-panel-ghost')).toBeNull()
    fireEvent.click(screen.getByTestId('list-panel-collapse'))
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(true)
    // Re-render: ghost now visible
    expect(screen.getByTestId('list-panel-ghost')).toBeDefined()
  })

  it('clicking the ghost re-expands the list', () => {
    useViewModeStore.setState({ listPanelCollapsed: true })
    render(<Wrapper><ReviewPage /></Wrapper>)
    expect(screen.getByTestId('list-panel-ghost')).toBeDefined()
    fireEvent.click(screen.getByTestId('list-panel-ghost-expand'))
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(false)
  })
})

describe('reviewPage integration — mobile, no issue selected', () => {
  beforeEach(() => {
    isMobileMock.mockReturnValue(true)
    useViewModeStore.setState({
      sidebarCollapsed: false,
      listPanelCollapsed: false,
    })
  })

  it('defaults to List mode (mobile tabs show, list panel mounts)', () => {
    render(<Wrapper><ReviewPage /></Wrapper>)
    // Mobile tabs rendered inside list panel header
    expect(screen.getByTestId('cockpit-mobile-tabs')).toBeDefined()
    expect(screen.getByTestId('cockpit-mobile-tab-list')).toBeDefined()
    // App sidebar NOT rendered on mobile
    expect(screen.queryByTestId('app-sidebar-stub')).toBeNull()
  })

  it('switching to Cockpit tab swaps list out and renders full-width CockpitDashboard', () => {
    render(<Wrapper><ReviewPage /></Wrapper>)
    fireEvent.click(screen.getByTestId('cockpit-mobile-tab-cockpit'))
    // List panel collapse button should NOT be present (we are in cockpit mode)
    expect(screen.queryByTestId('list-panel-collapse')).toBeNull()
    // Always-on bot timeline is the primary mobile cockpit surface.
    expect(screen.getByTestId('bot-timeline-stub')).toBeDefined()
    // Matrix lives under the lazy disclosure and is not mounted by default.
    expect(screen.queryByTestId('cockpit-matrix-mobile-card-p1')).toBeNull()
    // Mobile tabs still present (rendered in the cockpit container header)
    expect(screen.getAllByTestId('cockpit-mobile-tabs').length).toBeGreaterThan(0)
  })

  it('list panel collapse button is NOT exposed on mobile', () => {
    render(<Wrapper><ReviewPage /></Wrapper>)
    expect(screen.queryByTestId('list-panel-collapse')).toBeNull()
  })
})

// ── cockpit cleanup: RecentTabs removed, ChatArea title bar suppressed
// on desktop, kept on mobile (no TopBar there). Pins both behaviors so a
// later refactor can't silently bring back the dual-header / tab-strip
// duplication users complained about.

describe('reviewPage integration — cockpit cleanup', () => {
  beforeEach(() => {
    isMobileMock.mockReturnValue(false)
    chatAreaProps.mockReset()
    useViewModeStore.setState({ sidebarCollapsed: false, listPanelCollapsed: false })
  })

  it('does not render RecentTabs on desktop with no issue', () => {
    render(<Wrapper><ReviewPage /></Wrapper>)
    expect(screen.queryByTestId('recent-tabs')).toBeNull()
  })

  it('does not render RecentTabs on desktop with an open issue', () => {
    render(<Wrapper initialPath="/review/alpha/i1"><ReviewPage /></Wrapper>)
    expect(screen.queryByTestId('recent-tabs')).toBeNull()
    expect(screen.getByTestId('chat-area-stub')).toBeDefined()
  })

  it('passes hideTitleBar=true to ChatArea on desktop cockpit', () => {
    render(<Wrapper initialPath="/review/alpha/i1"><ReviewPage /></Wrapper>)
    expect(chatAreaProps).toHaveBeenCalled()
    const last = chatAreaProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(last.hideTitleBar).toBe(true)
  })

  it('passes hideTitleBar=false to ChatArea on mobile cockpit (no TopBar there)', () => {
    isMobileMock.mockReturnValue(true)
    render(<Wrapper initialPath="/review/alpha/i1"><ReviewPage /></Wrapper>)
    const last = chatAreaProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(last.hideTitleBar).toBe(false)
  })
})

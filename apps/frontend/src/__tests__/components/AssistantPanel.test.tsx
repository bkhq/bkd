import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssistantPanel } from '@/components/cockpit/AssistantPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const useIsMobileMock = vi.fn()
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

vi.mock('@/hooks/use-cockpit-assistant', () => ({
  useCockpitAssistant: () => ({
    data: {
      issueId: 'assistant-issue-id',
      projectId: '__cockpit__project',
      projectAlias: '__cockpit__',
    },
    isLoading: false,
  }),
  useCockpitAsk: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/use-cockpit-proposals', () => ({
  useCockpitProposals: () => ({ data: [], isLoading: false }),
  useApproveCockpitProposal: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectCockpitProposal: () => ({ mutate: vi.fn(), isPending: false }),
  useCockpitReset: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/components/issue-detail/ChatBody', () => ({
  ChatBody: () => <div data-testid="assistant-chatbody-stub" />,
}))

vi.mock('@/hooks/use-kanban', () => ({
  useIssue: () => ({
    data: {
      id: 'assistant-issue-id',
      projectId: '__cockpit__project',
      statusId: 'working',
      issueNumber: 1,
      title: '[Cockpit] Assistant',
      sessionStatus: null,
      prompt: null,
      tags: ['cockpit'],
      sortOrder: 'a0',
      useWorktree: false,
      isPinned: false,
      keepAlive: false,
      isHidden: true,
      engineType: 'claude-code-sdk',
      externalSessionId: null,
      model: null,
      statusUpdatedAt: '2026-05-19T00:00:00.000Z',
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    },
    isLoading: false,
  }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('assistantPanel responsive', () => {
  beforeEach(() => {
    useIsMobileMock.mockReset()
  })

  it('does not render anything when closed', () => {
    useIsMobileMock.mockReturnValue(false)
    const onClose = vi.fn()
    render(<Wrapper><AssistantPanel open={false} onClose={onClose} /></Wrapper>)
    expect(screen.queryByTestId('assistant-panel-desktop-dock')).toBeNull()
    expect(screen.queryByTestId('assistant-panel-mobile-sheet')).toBeNull()
  })

  it('desktop open uses the dock wrapper', () => {
    useIsMobileMock.mockReturnValue(false)
    render(<Wrapper><AssistantPanel open={true} onClose={vi.fn()} /></Wrapper>)
    expect(screen.getByTestId('assistant-panel-desktop-dock')).toBeDefined()
    expect(screen.queryByTestId('assistant-panel-mobile-sheet')).toBeNull()
  })

  it('mobile open uses the bottom sheet wrapper', () => {
    useIsMobileMock.mockReturnValue(true)
    render(<Wrapper><AssistantPanel open={true} onClose={vi.fn()} /></Wrapper>)
    expect(screen.getByTestId('assistant-panel-mobile-sheet')).toBeDefined()
    expect(screen.queryByTestId('assistant-panel-desktop-dock')).toBeNull()
  })

  it('desktop close button calls onClose', () => {
    useIsMobileMock.mockReturnValue(false)
    const onClose = vi.fn()
    render(<Wrapper><AssistantPanel open={true} onClose={onClose} /></Wrapper>)
    fireEvent.click(screen.getByTestId('assistant-panel-close'))
    expect(onClose).toHaveBeenCalled()
  })
})

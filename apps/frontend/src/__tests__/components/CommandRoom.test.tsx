import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CommandRoom from '@/components/workspace/CommandRoom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const useIssueMock = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useIssue: (...args: unknown[]) => useIssueMock(...args),
}))

vi.mock('@/components/issue-detail/ChatArea', () => ({
  ChatArea: ({ projectId, issueId }: { projectId: string, issueId: string }) => (
    <div data-testid="chat-area-stub" data-project={projectId} data-issue={issueId}>
      ChatArea
    </div>
  ),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('commandRoom', () => {
  it('renders room not found when issue is undefined', () => {
    useIssueMock.mockReturnValue({ data: undefined })
    render(<Wrapper><CommandRoom roomIssueId="test-issue" projectId="test-project" /></Wrapper>)
    expect(screen.getByText('Room not found')).toBeDefined()
  })

  it('renders issue title and ChatArea when issue is loaded', () => {
    useIssueMock.mockReturnValue({
      data: { id: 'test-issue', title: 'My Room Title', projectId: 'test-project' },
    })
    render(<Wrapper><CommandRoom roomIssueId="test-issue" projectId="test-project" /></Wrapper>)
    expect(screen.getByText('My Room Title')).toBeDefined()
    const chatStub = screen.getByTestId('chat-area-stub')
    expect(chatStub).toBeDefined()
    expect(chatStub.dataset.project).toBe('test-project')
    expect(chatStub.dataset.issue).toBe('test-issue')
  })

  it('passes correct projectId to useIssue', () => {
    useIssueMock.mockReturnValue({ data: undefined })
    render(<Wrapper><CommandRoom roomIssueId="abc-123" projectId="my-proj" /></Wrapper>)
    expect(useIssueMock).toHaveBeenCalledWith('my-proj', 'abc-123')
  })
})

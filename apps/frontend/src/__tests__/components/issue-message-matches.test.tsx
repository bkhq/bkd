import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueMessageMatches } from '@/components/issue-detail/IssueMessageMatches'

const searchIssuesMock = vi.fn()

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    searchIssues: (...args: unknown[]) => searchIssuesMock(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const hit = (id: string, issueNumber: number, title: string, snippet: string) => ({
  issue: { id, issueNumber, title },
  matchCount: 1,
  snippet,
  logId: `log-${id}`,
  turnIndex: 0,
})

function renderMatches(query: string, excludeIds = new Set<string>(), onNavigate = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IssueMessageMatches projectId="p1" query={query} excludeIds={excludeIds} onNavigate={onNavigate} />
    </QueryClientProvider>,
  )
  return onNavigate
}

afterEach(cleanup)

describe('issueMessageMatches', () => {
  beforeEach(() => {
    searchIssuesMock.mockReset()
  })

  it('lists message matches with the query highlighted and navigates on click', async () => {
    searchIssuesMock.mockResolvedValue([hit('i1', 7, 'Login bug', 'fix the Reconnect logic')])
    const onNavigate = renderMatches('reconnect')

    const mark = await screen.findByText('Reconnect')
    expect(mark.tagName).toBe('MARK')
    expect(searchIssuesMock).toHaveBeenCalledWith('p1', 'reconnect')
    expect(screen.getByText('Login bug')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Login bug/ }))
    expect(onNavigate).toHaveBeenCalledWith('i1')
  })

  it('hides issues already listed by title', async () => {
    searchIssuesMock.mockResolvedValue([
      hit('i1', 1, 'Shown', 'reconnect one'),
      hit('i2', 2, 'Other', 'reconnect two'),
    ])
    renderMatches('reconnect', new Set(['i1']))

    expect(await screen.findByText('Other')).toBeTruthy()
    expect(screen.queryByText('Shown')).toBeNull()
  })

  it('does not search for a one-character query', async () => {
    renderMatches('r')
    await new Promise(r => setTimeout(r, 400))
    expect(searchIssuesMock).not.toHaveBeenCalled()
  })

  it('renders nothing when there are no matches', async () => {
    searchIssuesMock.mockResolvedValue([])
    renderMatches('nothing')
    await waitFor(() => expect(searchIssuesMock).toHaveBeenCalled())
    expect(screen.queryByText('issue.messageMatches')).toBeNull()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatInput } from '@/components/issue-detail/ChatInput'

/** Top row of the chat input card (changes button, mode, effort, model) on narrow chat columns. */

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, o?: { count?: number }) => (o?.count === undefined ? key : `${key}:${o.count}`) }) }))
vi.mock('@/hooks/use-changes-summary', () => ({ useChangesSummary: () => ({ fileCount: 13, additions: 739, deletions: 56 }) }))
vi.mock('@/hooks/use-skills', () => ({ useSkills: () => ({ data: undefined }) }))
vi.mock('@/hooks/use-kanban', () => ({
  useFollowUpIssue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearIssueSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutate: vi.fn() }),
  useEngineAvailability: () => ({ data: undefined }),
  useEngineSettings: () => ({ data: undefined }),
  useEngineProfiles: () => ({ data: [] }),
  useVirtualEngines: () => ({ data: [] }),
}))

describe('chatInput top row on narrow columns', () => {
  it('shortens the changes button to its count instead of wrapping the label', () => {
    render(<ChatInput projectId="p1" issueId="i1" engineType="claude-code" />)
    const button = screen.getByTitle('diff.openFiles')
    expect(button).toHaveClass('shrink-0', 'whitespace-nowrap')
    expect(screen.getByText('chat.filesChanged:13')).toHaveClass('hidden', '@md:inline')
    expect(screen.getByText('13')).toHaveClass('@md:hidden')
    // The row is the container the breakpoints measure, and the selects may shrink
    expect(button.parentElement).toHaveClass('@container')
    expect(button.nextElementSibling).toHaveClass('min-w-0')
  })
})

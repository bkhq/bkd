import type { Issue } from '@/types/kanban'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IssueDetail } from '@/components/issue-detail/IssueDetail'

/** Issue toolbar above the chat input: it must fit narrow chat columns instead of clipping. */

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-kanban', () => ({ useProjectWorktrees: () => ({ data: [] }) }))
vi.mock('@/hooks/use-context-usage', () => ({ useContextUsage: () => undefined }))

const issue = {
  id: 'i1',
  projectId: 'p1',
  statusId: 'review',
  issueNumber: 1,
  title: 'Issue',
  engineType: 'claude-code',
  keepAlive: false,
  useWorktree: false,
  tags: null,
  contextTokens: 496_100,
  contextWindow: 1_000_000,
  totalInputTokens: 102_200_000,
  totalOutputTokens: 219_800,
  totalCostUsd: '41.23',
} as unknown as Issue

function renderBar() {
  render(<IssueDetail issue={issue} projectId="p1" onDelete={() => {}} />)
  return screen.getByTitle('issue.delete').parentElement!
}

describe('issue toolbar on narrow columns', () => {
  it('wraps instead of clipping, sized by its own width', () => {
    const bar = renderBar()
    expect(bar).toHaveClass('@container', 'flex-wrap')
  })

  it('folds the delete and dev labels to their icons until the column is wide enough', () => {
    renderBar()
    expect(screen.getByText('issue.delete')).toHaveClass('hidden', '@lg:inline')
    expect(screen.getByText('issue.devMode')).toHaveClass('hidden', '@lg:inline')
    // An empty tag shows only its icon too; real tags stay visible
    expect(screen.getByText('issue.tag')).toHaveClass('hidden', '@lg:inline')
  })

  it('keeps the context percentage and the cost, folding their details', () => {
    renderBar()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('· 496.1k/1.0M')).toHaveClass('hidden', '@2xl:inline')
    expect(screen.getByText('$41.23')).toBeInTheDocument()
    expect(screen.getByText(/↑102\.2M/)).toHaveClass('hidden', '@2xl:inline')
  })
})

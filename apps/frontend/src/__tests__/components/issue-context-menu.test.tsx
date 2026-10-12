import type { Issue } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueContextMenu, IssueRightClickMenu } from '@/components/issue-detail/IssueContextMenu'
import i18n from '@/i18n'
import { getIssueUrl } from '@/stores/server-store'

/** Right-click and header variants of the issue action menu. */

vi.mock('@/hooks/use-kanban', () => ({
  useUpdateIssue: () => ({ mutate: vi.fn() }),
  useDeleteIssue: () => ({ mutate: vi.fn() }),
  useDuplicateIssue: () => ({ mutate: vi.fn() }),
}))

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)

const issue = { id: 'i1', issueNumber: 1, title: 'Fix it', isPinned: false } as unknown as Issue

describe('issue action menus', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    writeText.mockClear()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('opens the row menu on right-click', async () => {
    render(
      <IssueRightClickMenu issue={issue} projectId="p1" showPin>
        <div>row</div>
      </IssueRightClickMenu>,
    )
    fireEvent.contextMenu(screen.getByText('row'))
    for (const label of ['Pin to top', 'Rename', 'Copy', 'Download', 'Delete'])
      expect(await screen.findByRole('menuitem', { name: label })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Copy link' })).toBeNull()
  })

  it('offers copy link in the header menu and writes the issue URL', async () => {
    render(
      <IssueContextMenu issue={issue} projectId="p1" showPin showCopyLink>
        <button type="button">more</button>
      </IssueContextMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(getIssueUrl('p1', 'i1'))
  })
})

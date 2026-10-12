import type { Issue } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IssueContextMenu, IssueContextMenuButton, IssueRightClickMenu } from '@/components/issue-detail/IssueContextMenu'
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
        <IssueContextMenuButton />
      </IssueContextMenu>,
    )
    // Real browsers send mousedown first; base-ui opens on it and must ignore the
    // following click. The button has to forward the injected handlers for that.
    const dots = screen.getByRole('button', { name: 'More actions' })
    fireEvent.pointerDown(dots, { button: 0, pointerType: 'mouse', isPrimary: true })
    fireEvent.mouseDown(dots, { button: 0 })
    fireEvent.pointerUp(dots, { button: 0, pointerType: 'mouse', isPrimary: true })
    fireEvent.mouseUp(dots, { button: 0 })
    fireEvent.click(dots, { button: 0 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(getIssueUrl('p1', 'i1'))
  })
})

describe('issue list row', () => {
  it('keeps the "..." button outside the right-click trigger and opens both menus', async () => {
    const { IssueRow } = await import('@/components/issue-detail/IssueListPanel')
    render(
      <IssueRow issue={issue} projectId="p1" isActive={false} onNavigate={() => {}} onActiveDeleted={() => {}} />,
    )
    const dots = screen.getAllByRole('button').find(b => b.tagName === 'BUTTON')!
    // base-ui treats a Menu nested under ContextMenu.Root as its submenu, so the
    // dropdown trigger must not sit inside the right-click wrapper.
    expect(dots.closest('[data-slot="issue-context-trigger"]')).toBeNull()
    fireEvent.click(dots)
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    // The hover-only wrapper must stay visible while the menu is open (pointer leaves the row).
    expect(dots).toHaveAttribute('data-popup-open')
    expect(dots.parentElement).toHaveClass('has-data-popup-open:opacity-100')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByText('Fix it'))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })
})

describe('issue list row menu isolation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('does not navigate when a right-click menu action or its dialog is used', async () => {
    const { IssueRow } = await import('@/components/issue-detail/IssueListPanel')
    const onNavigate = vi.fn()
    render(
      <IssueRow issue={issue} projectId="p1" isActive={false} onNavigate={onNavigate} onActiveDeleted={() => {}} />,
    )
    fireEvent.contextMenu(screen.getByText('Fix it'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByPlaceholderText('New title')
    fireEvent.click(input)
    // An unprevented keydown is what lets the browser type the space / submit the form.
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('still navigates on a row click and on Enter with the row focused', async () => {
    const { IssueRow } = await import('@/components/issue-detail/IssueListPanel')
    const onNavigate = vi.fn()
    render(
      <IssueRow issue={issue} projectId="p1" isActive={false} onNavigate={onNavigate} onActiveDeleted={() => {}} />,
    )
    fireEvent.click(screen.getByText('Fix it'))
    fireEvent.keyDown(screen.getByText('Fix it').closest('[role="button"]')!, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })
})

describe('issue list group header', () => {
  it('offers "+" only for Todo and Working and presets the create dialog status', async () => {
    const { StatusGroup } = await import('@/components/issue-detail/IssueListPanel')
    const { STATUS_MAP } = await import('@/lib/statuses')
    const { usePanelStore } = await import('@/stores/panel-store')
    const props = { issues: [], projectId: 'p1', isCollapsed: false, onToggle: () => {}, activeIssueId: '', onNavigate: () => {}, onActiveDeleted: () => {} }
    const { unmount } = render(<StatusGroup status={STATUS_MAP.get('working')!} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create issue in Working' }))
    expect(usePanelStore.getState().createDialogOpen).toBe(true)
    expect(usePanelStore.getState().createDialogStatusId).toBe('working')
    unmount()
    render(<StatusGroup status={STATUS_MAP.get('done')!} {...props} />)
    expect(screen.queryByRole('button', { name: /Create issue in/ })).toBeNull()
  })
})

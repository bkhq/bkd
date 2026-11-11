import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileBrowserDrawer } from '@/components/files/FileBrowserDrawer'
import i18n from '@/i18n'
import { useFileBrowserStore } from '@/stores/file-browser-store'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/components/files/WorkspaceFiles', () => ({
  WorkspaceFiles: ({ projectId, headerActions }: { projectId: string, headerActions?: ReactNode }) => (
    <div>
      <p>{`file manager ${projectId}`}</p>
      <div data-testid="fm-header">{headerActions}</div>
    </div>
  ),
}))

describe('file browser drawer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useFileBrowserStore.setState({ isOpen: true, isMinimized: false, isFullscreen: false, projectId: 'p1', issueId: null })
  })

  it('is the file manager itself: no title bar of its own, its controls in the manager\'s top bar', () => {
    render(<FileBrowserDrawer />)
    expect(screen.queryByText(i18n.t('fileBrowser.title'))).toBeNull()
    const header = within(screen.getByTestId('fm-header'))
    expect(header.getByRole('button', { name: i18n.t('terminal.minimize') })).toBeInTheDocument()
    expect(header.getByRole('button', { name: i18n.t('terminal.maximize') })).toBeInTheDocument()
    fireEvent.click(header.getByRole('button', { name: i18n.t('fileBrowser.close') }))
    expect(useFileBrowserStore.getState().isOpen).toBe(false)
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidePanel, SidePanelActions } from '@/components/ui/side-panel'

/** Shared side panel shell (UI-006). */

function renderPanel(props: Partial<Parameters<typeof SidePanel>[0]> = {}) {
  const onClose = vi.fn()
  const onWidthChange = vi.fn()
  render(
    <SidePanel
      label="Test panel"
      width={500}
      onWidthChange={onWidthChange}
      minWidth={300}
      maxWidth={900}
      resizeLabel="Resize"
      fullscreen={false}
      onClose={onClose}
      title={<span>Title</span>}
      {...props}
    >
      <p>Body</p>
    </SidePanel>,
  )
  return { onClose, onWidthChange }
}

describe('sidePanel', () => {
  it('renders as a labelled modal dialog at the given width', () => {
    renderPanel()
    const dialog = screen.getByRole('dialog', { name: 'Test panel' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.style.width).toBe('500px')
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops the backdrop and the resize handle in fullscreen', () => {
    renderPanel({ fullscreen: true })
    const dialog = screen.getByRole('dialog', { name: 'Test panel' })
    expect(dialog.style.width).toBe('')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('omits the header when no title is given', () => {
    renderPanel({ title: undefined })
    expect(screen.queryByText('Title')).not.toBeInTheDocument()
  })
})

describe('sidePanelActions', () => {
  it('renders only the controls it is given a handler for', () => {
    render(<SidePanelActions onClose={vi.fn()} closeLabel="Close" />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('wires minimize, fullscreen and close', () => {
    const onMinimize = vi.fn()
    const onToggleFullscreen = vi.fn()
    const onClose = vi.fn()
    render(
      <SidePanelActions
        onMinimize={onMinimize}
        minimizeLabel="Minimize"
        onToggleFullscreen={onToggleFullscreen}
        fullscreenLabel="Maximize"
        restoreLabel="Restore"
        onClose={onClose}
        closeLabel="Close"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onMinimize).toHaveBeenCalledTimes(1)
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the restore label once fullscreen', () => {
    render(
      <SidePanelActions
        isFullscreen
        onToggleFullscreen={vi.fn()}
        fullscreenLabel="Maximize"
        restoreLabel="Restore"
        onClose={vi.fn()}
        closeLabel="Close"
      />,
    )
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const store = () => useWorkspacePanelStore.getState()

describe('workspace-panel-store', () => {
  beforeEach(() => {
    useWorkspacePanelStore.setState({ isOpen: false, isMaximized: false })
  })

  it('starts hidden and has no tabs', () => {
    const initial = useWorkspacePanelStore.getInitialState()
    expect(initial.isOpen).toBe(false)
    expect('tabs' in initial).toBe(false)
  })

  it('togglePanel shows and hides the panel', () => {
    store().togglePanel()
    expect(store().isOpen).toBe(true)
    store().togglePanel()
    expect(store().isOpen).toBe(false)
  })

  it('toggleMaximized expands the panel; hiding the panel restores the normal width', () => {
    store().togglePanel()
    store().toggleMaximized()
    expect(store().isMaximized).toBe(true)
    store().toggleMaximized()
    expect(store().isMaximized).toBe(false)
    store().toggleMaximized()
    store().togglePanel()
    expect(store().isMaximized).toBe(false)
  })

  it('hide closes the panel and leaves the maximized state', () => {
    store().togglePanel()
    store().toggleMaximized()
    store().hide()
    expect(store().isOpen).toBe(false)
    expect(store().isMaximized).toBe(false)
  })

  it('starts 400px wide, at most 60% of the viewport', () => {
    expect(useWorkspacePanelStore.getInitialState().width).toBe(Math.min(400, Math.round(window.innerWidth * 0.6)))
  })

  it('keeps its width when shown again', () => {
    useWorkspacePanelStore.setState({ width: 500 })
    store().togglePanel()
    store().togglePanel()
    store().togglePanel()
    expect(store().width).toBe(500)
  })

  it('keeps the chat at its minimum: width caps at the viewport and re-clamps on resize', () => {
    window.innerWidth = 1600
    store().setWidth(2000)
    expect(store().width).toBe(1600 - 56 - 300)

    useWorkspacePanelStore.setState({ width: 640 })
    window.innerWidth = 800
    window.dispatchEvent(new Event('resize'))
    expect(store().width).toBe(800 - 56 - 300)

    window.innerWidth = 500
    window.dispatchEvent(new Event('resize'))
    expect(store().width).toBe(320)
  })
})

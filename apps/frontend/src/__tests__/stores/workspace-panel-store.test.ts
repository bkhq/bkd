import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const store = () => useWorkspacePanelStore.getState()

describe('workspace-panel-store', () => {
  beforeEach(() => {
    useWorkspacePanelStore.setState({ isOpen: false, isMaximized: false, tabs: ['files', 'review'], activeTab: 'files' })
  })

  it('starts hidden with no tabs', () => {
    const initial = useWorkspacePanelStore.getInitialState()
    expect(initial.isOpen).toBe(false)
    expect(initial.tabs).toEqual([])
    expect(initial.activeTab).toBeNull()
  })

  it('togglePanel shows and hides without touching tabs', () => {
    store().togglePanel()
    expect(store().isOpen).toBe(true)
    store().togglePanel()
    expect(store().isOpen).toBe(false)
    expect(store().tabs).toEqual(['files', 'review'])
  })

  it('closing a tab activates a neighbour; closing the last tab hides the panel', () => {
    store().togglePanel()
    store().closeTab('files')
    expect(store().tabs).toEqual(['review'])
    expect(store().activeTab).toBe('review')
    expect(store().isOpen).toBe(true)
    store().closeTab('review')
    expect(store().tabs).toEqual([])
    expect(store().activeTab).toBeNull()
    expect(store().isOpen).toBe(false)
  })

  it('togglePanel with no tabs opens the empty launcher', () => {
    useWorkspacePanelStore.setState({ isOpen: false, tabs: [], activeTab: null })
    store().togglePanel()
    expect(store().isOpen).toBe(true)
    expect(store().tabs).toEqual([])
    expect(store().activeTab).toBeNull()
  })

  it('opening tabs from the launcher keeps files before review', () => {
    useWorkspacePanelStore.setState({ isOpen: true, tabs: [], activeTab: null })
    store().toggleTab('review')
    store().toggleTab('files')
    expect(store().tabs).toEqual(['files', 'review'])
    expect(store().activeTab).toBe('files')
  })

  it('toggleTab opens a closed tab, activates it, then hides the panel on a second call', () => {
    useWorkspacePanelStore.setState({ isOpen: false, tabs: ['files'], activeTab: 'files' })
    store().toggleTab('review')
    expect(store().isOpen).toBe(true)
    expect(store().tabs).toEqual(['files', 'review'])
    expect(store().activeTab).toBe('review')
    store().toggleTab('review')
    expect(store().isOpen).toBe(false)
  })

  it('toggleTab switches to another open tab instead of hiding', () => {
    store().togglePanel()
    store().toggleTab('review')
    expect(store().isOpen).toBe(true)
    expect(store().activeTab).toBe('review')
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

  it('closing the last tab also leaves the maximized state', () => {
    store().togglePanel()
    store().toggleMaximized()
    store().closeTab('files')
    expect(store().isMaximized).toBe(true)
    store().closeTab('review')
    expect(store().isMaximized).toBe(false)
  })
  it('openTab adds and activates a tab without ever hiding the panel', () => {
    useWorkspacePanelStore.setState({ isOpen: true, tabs: ['review'], activeTab: 'review' })
    store().openTab('review')
    expect(store().isOpen).toBe(true)
    store().openTab('files')
    expect(store().tabs).toEqual(['files', 'review'])
    expect(store().activeTab).toBe('files')
  })
  it('ensureWidth only widens, and stays within 60% of the viewport', () => {
    window.innerWidth = 1600
    useWorkspacePanelStore.setState({ width: 400 })
    store().ensureWidth(640)
    expect(store().width).toBe(640)
    useWorkspacePanelStore.setState({ width: 800 })
    store().ensureWidth(640)
    expect(store().width).toBe(800)
    window.innerWidth = 900
    useWorkspacePanelStore.setState({ width: 400 })
    store().ensureWidth(640)
    expect(store().width).toBe(540)
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

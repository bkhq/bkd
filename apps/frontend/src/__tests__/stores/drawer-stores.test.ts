import { beforeEach, describe, expect, it } from 'vitest'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { NOTES_MIN_WIDTH, useNotesStore } from '@/stores/notes-store'
import { TERMINAL_MAX_WIDTH_RATIO, TERMINAL_MIN_WIDTH, useTerminalStore } from '@/stores/terminal-store'

describe('drawer stores', () => {
  beforeEach(() => {
    useTerminalStore.setState({ isOpen: false, isMinimized: false, isFullscreen: false })
    useFileBrowserStore.setState({ isOpen: false, isMinimized: false, projectId: null, issueId: null })
  })

  it('toggle opens, closes, and restores a minimized drawer', () => {
    const { toggle, minimize } = useTerminalStore.getState()
    toggle()
    expect(useTerminalStore.getState().isOpen).toBe(true)
    toggle()
    expect(useTerminalStore.getState().isOpen).toBe(false)

    toggle()
    minimize()
    expect(useTerminalStore.getState()).toMatchObject({ isOpen: false, isMinimized: true })
    toggle()
    expect(useTerminalStore.getState()).toMatchObject({ isOpen: true, isMinimized: false })
  })

  it('minimize leaves fullscreen and openFullscreen enters it', () => {
    useTerminalStore.getState().openFullscreen()
    expect(useTerminalStore.getState()).toMatchObject({ isOpen: true, isFullscreen: true })
    useTerminalStore.getState().minimize()
    expect(useTerminalStore.getState().isFullscreen).toBe(false)
  })

  it('clamps the width between the minimum and the viewport share', () => {
    useTerminalStore.getState().setWidth(10)
    expect(useTerminalStore.getState().width).toBe(TERMINAL_MIN_WIDTH)
    useTerminalStore.getState().setWidth(100_000)
    expect(useTerminalStore.getState().width).toBe(window.innerWidth * TERMINAL_MAX_WIDTH_RATIO)
  })

  it('keeps each store on its own configuration', () => {
    useNotesStore.getState().setWidth(10)
    expect(useNotesStore.getState().width).toBe(NOTES_MIN_WIDTH)
    expect(NOTES_MIN_WIDTH).not.toBe(TERMINAL_MIN_WIDTH)
  })

  it('file browser toggles per project and issue', () => {
    const { toggleDrawer } = useFileBrowserStore.getState()
    toggleDrawer('p1', 'i1')
    expect(useFileBrowserStore.getState()).toMatchObject({ isOpen: true, projectId: 'p1', issueId: 'i1' })
    toggleDrawer('p1', 'i2')
    expect(useFileBrowserStore.getState()).toMatchObject({ isOpen: true, issueId: 'i2' })
    toggleDrawer('p1', 'i2')
    expect(useFileBrowserStore.getState().isOpen).toBe(false)
  })
})

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let useViewModeStore: typeof import('../../stores/view-mode-store').useViewModeStore

describe('view-mode-store sidebar collapsed', () => {
  beforeAll(() => {
    // jsdom does not provide localStorage by default; stub it so the store
    // can read/write without throwing.
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
    })
  })

  beforeEach(async () => {
    // Re-import so the store initialises with the stubbed localStorage.
    const mod = await import('../../stores/view-mode-store')
    useViewModeStore = mod.useViewModeStore
    useViewModeStore.setState({ sidebarCollapsed: false })
  })

  it('defaults to expanded', () => {
    expect(useViewModeStore.getState().sidebarCollapsed).toBe(false)
  })

  it('toggles from false to true', () => {
    const { toggleSidebar } = useViewModeStore.getState()

    toggleSidebar()

    expect(useViewModeStore.getState().sidebarCollapsed).toBe(true)
  })

  it('toggles from true to false', () => {
    useViewModeStore.setState({ sidebarCollapsed: true })
    const { toggleSidebar } = useViewModeStore.getState()

    toggleSidebar()

    expect(useViewModeStore.getState().sidebarCollapsed).toBe(false)
  })

  it('multiple toggles cycle correctly', () => {
    const { toggleSidebar } = useViewModeStore.getState()

    toggleSidebar() // false → true
    expect(useViewModeStore.getState().sidebarCollapsed).toBe(true)

    toggleSidebar() // true → false
    expect(useViewModeStore.getState().sidebarCollapsed).toBe(false)

    toggleSidebar() // false → true
    expect(useViewModeStore.getState().sidebarCollapsed).toBe(true)
  })
})

import { create } from 'zustand'

/**
 * Per-issue scroll position memory.
 *
 * When the user navigates between issues, we persist where they were
 * scrolled in each one and restore it on return. Mirrors the behaviour
 * of Slack / Discord / mail clients where revisiting a thread doesn't
 * lose your reading place.
 *
 * Design choices:
 * - Stored as a flat `issueId → scrollTop` map; cheap (O(1) read/write).
 * - Persisted to localStorage so it survives full reloads / tab close.
 * - Capped at 200 entries via `prune()` so a long-tenured fork doesn't
 *   bloat the JSON blob with stale issue keys; oldest entries (lowest
 *   scrollTop / least recently set) are evicted first by FIFO order.
 * - In-memory map seeded from localStorage at module load; subsequent
 *   reads / writes hit memory (no JSON parse on every scroll event).
 */

const STORAGE_KEY = 'bkd-scroll-positions'
const MAX_ENTRIES = 200

interface ScrollPositionStore {
  positions: Record<string, number>
  setPosition: (issueId: string, top: number) => void
  getPosition: (issueId: string) => number | undefined
  clear: (issueId: string) => void
}

function loadPositions(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(positions: Record<string, number>) {
  if (typeof window === 'undefined') return
  // Throttle writes to avoid hammering localStorage on every scroll tick.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
    } catch {
      /* quota / disabled storage — silently drop */
    }
  }, 500)
}

export const useScrollPositionStore = create<ScrollPositionStore>((set, get) => ({
  positions: loadPositions(),
  setPosition: (issueId, top) => {
    set((state) => {
      const next = { ...state.positions, [issueId]: top }
      // FIFO prune when the map gets too big — keep the most recent 200.
      const keys = Object.keys(next)
      if (keys.length > MAX_ENTRIES) {
        const drop = keys.length - MAX_ENTRIES
        for (let i = 0; i < drop; i++) {
          delete next[keys[i]]
        }
      }
      schedulePersist(next)
      return { positions: next }
    })
  },
  getPosition: (issueId) => {
    return get().positions[issueId]
  },
  clear: (issueId) => {
    set((state) => {
      if (!(issueId in state.positions)) return state
      const next = { ...state.positions }
      delete next[issueId]
      schedulePersist(next)
      return { positions: next }
    })
  },
}))

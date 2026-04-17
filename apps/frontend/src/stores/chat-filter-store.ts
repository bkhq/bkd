import { create } from 'zustand'

interface ChatFilterStore {
  devMode: boolean
  setDevMode: (value: boolean) => void
  toggleDevMode: () => void
}

const STORAGE_KEY = 'bkd-chat-dev-mode'

function loadDevMode(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === null) return true
  return stored === 'true'
}

export const useChatFilterStore = create<ChatFilterStore>((set, get) => ({
  // devMode=true (default)  → full raw view including tool-use / system-message.
  // devMode=false           → concise view: user / assistant / thinking only.
  devMode: loadDevMode(),

  setDevMode: (value) => {
    localStorage.setItem(STORAGE_KEY, String(value))
    set({ devMode: value })
  },

  toggleDevMode: () => {
    const next = !get().devMode
    localStorage.setItem(STORAGE_KEY, String(next))
    set({ devMode: next })
  },
}))

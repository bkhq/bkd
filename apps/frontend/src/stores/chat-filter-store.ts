import { create } from 'zustand'

interface ChatFilterStore {
  devMode: boolean
  setDevMode: (value: boolean) => void
  toggleDevMode: () => void
}

const STORAGE_KEY = 'bkd-chat-dev-mode'

function loadDevMode(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

export const useChatFilterStore = create<ChatFilterStore>((set, get) => ({
  // devMode=false (default) → concise view: user / assistant / thinking only.
  // devMode=true            → full raw view including tool-use / system-message.
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

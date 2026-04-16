import { create } from 'zustand'

interface ChatFilterStore {
  onlyMode: boolean
  setOnlyMode: (value: boolean) => void
  toggleOnlyMode: () => void
}

const STORAGE_KEY = 'bkd-chat-only-mode'

function loadOnlyMode(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

export const useChatFilterStore = create<ChatFilterStore>((set, get) => ({
  onlyMode: loadOnlyMode(),

  setOnlyMode: (value) => {
    localStorage.setItem(STORAGE_KEY, String(value))
    set({ onlyMode: value })
  },

  toggleOnlyMode: () => {
    const next = !get().onlyMode
    localStorage.setItem(STORAGE_KEY, String(next))
    set({ onlyMode: next })
  },
}))

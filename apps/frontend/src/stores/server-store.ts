import { create } from 'zustand'

interface ServerStore {
  name: string | null
  url: string | null
  setServerInfo: (name: string | null, url: string | null) => void
}

export const useServerStore = create<ServerStore>((set) => ({
  name: null,
  url: null,
  setServerInfo: (name, url) => set({ name, url }),
}))

/** Build an external issue URL using server_url (if set) or window.location.origin as fallback. */
export function getIssueUrl(projectId: string, issueId: string): string {
  const base = useServerStore.getState().url || window.location.origin
  return `${base.replace(/\/+$/, '')}/projects/${projectId}/issues/${issueId}`
}

import { create } from 'zustand'

const DISMISS_DELAY_MS = 3000

export interface UploadItem {
  id: string
  fileName: string
  fileCount: number
  loaded: number
  total: number
  status: 'uploading' | 'done' | 'error'
}

interface UploadStore {
  uploads: UploadItem[]
  start: (files: File[]) => string
  progress: (id: string, loaded: number, total: number) => void
  finish: (id: string, status: 'done' | 'error') => void
}

let nextId = 0

function update(uploads: UploadItem[], id: string, patch: (u: UploadItem) => Partial<UploadItem>) {
  return uploads.map(u => (u.id === id ? { ...u, ...patch(u) } : u))
}

export const useUploadStore = create<UploadStore>(set => ({
  uploads: [],

  start: (files) => {
    const id = String(++nextId)
    const upload: UploadItem = {
      id,
      fileName: files[0]?.name ?? '',
      fileCount: files.length,
      loaded: 0,
      total: files.reduce((sum, f) => sum + f.size, 0),
      status: 'uploading',
    }
    set(s => ({ uploads: [...s.uploads, upload] }))
    return id
  },
  progress: (id, loaded, total) => set(s => ({ uploads: update(s.uploads, id, () => ({ loaded, total })) })),
  finish: (id, status) => {
    set(s => ({
      uploads: update(s.uploads, id, u => (status === 'done' ? { status, loaded: u.total } : { status })),
    }))
    setTimeout(() => set(s => ({ uploads: s.uploads.filter(u => u.id !== id) })), DISMISS_DELAY_MS)
  },
}))

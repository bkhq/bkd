import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'bkd:recent-issues'
const MAX_ITEMS = 20

export interface RecentIssue {
  id: string
  title: string
  issueNumber: number
  projectAlias: string
  projectName: string
  statusId: string
  accessedAt: string
}

// Module-level store. addRecentIssue / removeRecentIssue / clearRecentIssues
// mutate this cache then notify all subscribed consumers, so every component
// using useRecentIssues() rerenders immediately. Previously the hook read
// localStorage once on mount and never updated — making the recent-issues
// strip on the cockpit feel stale.

const listeners = new Set<() => void>()
let cache: RecentIssue[] = readStorage()

function readStorage(): RecentIssue[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RecentIssue[]) : []
  } catch {
    return []
  }
}

function writeStorage(items: RecentIssue[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* quota exceeded — ignore */
  }
}

function notify() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Cross-tab updates: storage event fires for other tabs only, so refresh
// the in-memory cache and notify local subscribers when it does.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    cache = readStorage()
    notify()
  })
}

export function useRecentIssues(): RecentIssue[] {
  return useSyncExternalStore(subscribe, () => cache, () => cache)
}

export function addRecentIssue(issue: Omit<RecentIssue, 'accessedAt'>) {
  const filtered = cache.filter(i => i.id !== issue.id)
  const updated = [
    { ...issue, accessedAt: new Date().toISOString() },
    ...filtered,
  ].slice(0, MAX_ITEMS)
  cache = updated
  writeStorage(updated)
  notify()
}

export function removeRecentIssue(id: string) {
  const next = cache.filter(i => i.id !== id)
  if (next.length === cache.length) return
  cache = next
  writeStorage(next)
  notify()
}

export function clearRecentIssues() {
  if (cache.length === 0) return
  cache = []
  writeStorage([])
  notify()
}

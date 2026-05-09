import { useState } from 'react'

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useRecentIssues(): RecentIssue[] {
  const [issues] = useState<RecentIssue[]>(readStorage)
  return issues
}

export function addRecentIssue(issue: Omit<RecentIssue, 'accessedAt'>) {
  const existing = readStorage()
  const filtered = existing.filter(i => i.id !== issue.id)
  const updated = [
    { ...issue, accessedAt: new Date().toISOString() },
    ...filtered,
  ].slice(0, MAX_ITEMS)
  writeStorage(updated)
}

export function clearRecentIssues() {
  writeStorage([])
}

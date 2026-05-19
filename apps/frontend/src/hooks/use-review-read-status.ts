import { useCallback, useMemo, useState } from 'react'
import { useReviewIssues } from '@/hooks/use-kanban'

const STORAGE_KEY = 'bkd:review-read-ids'

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // ignore
  }
}

export function useReviewReadStatus() {
  const { data: reviewIssues } = useReviewIssues()
  const [readIds, setReadIds] = useState<Set<string>>(getReadIds)

  const markAsRead = useCallback((issueId: string) => {
    setReadIds((prev) => {
      if (prev.has(issueId)) return prev
      const next = new Set(prev)
      next.add(issueId)
      // Keep only last 200 to prevent unbounded growth
      if (next.size > 200) {
        const arr = [...next]
        arr.splice(0, arr.length - 200)
        const trimmed = new Set(arr)
        saveReadIds(trimmed)
        return trimmed
      }
      saveReadIds(next)
      return next
    })
  }, [])

  const isRead = useCallback(
    (issueId: string) => readIds.has(issueId),
    [readIds],
  )

  const unreadCount = useMemo(() => {
    if (!reviewIssues) return 0
    return reviewIssues.filter(i => !readIds.has(i.id)).length
  }, [reviewIssues, readIds])

  return { markAsRead, isRead, unreadCount }
}

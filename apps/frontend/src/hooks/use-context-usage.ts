import type { ContextUsageEvent } from '@bkd/shared'
import { useEffect, useState } from 'react'
import { eventBus } from '@/lib/event-bus'

/**
 * Live SSE overlay for an issue's context-window usage.
 * Returns the latest `context-usage` event for the issue, or null until one
 * arrives — callers fall back to the issue row's persisted values.
 */
export function useContextUsage(issueId: string | undefined): ContextUsageEvent | null {
  const [usage, setUsage] = useState<ContextUsageEvent | null>(null)

  useEffect(() => {
    setUsage(null)
    if (!issueId) return

    return eventBus.onContextUsage((data) => {
      if (data.issueId === issueId) setUsage(data)
    })
  }, [issueId])

  return usage
}

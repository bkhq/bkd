import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import { eventBus } from '@/lib/event-bus'
import { queryKeys } from './use-kanban'

export function usePendingMessages(projectId: string, issueId: string | null) {
  const qc = useQueryClient()

  // Invalidate on SSE events that indicate pending messages may have been consumed
  useEffect(() => {
    if (!issueId) return

    const unsub = eventBus.subscribe(issueId, {
      onLog: () => {
        // A new log entry (e.g. engine consumed pending → emitted user-message) — refresh
        qc.invalidateQueries({ queryKey: queryKeys.pendingMessages(projectId, issueId) })
      },
      onLogUpdated: () => {},
      onLogRemoved: () => {
        // Pending message recalled/deleted
        qc.invalidateQueries({ queryKey: queryKeys.pendingMessages(projectId, issueId) })
      },
      onState: () => {
        // Session state changed (e.g. running → completed) — pending may have been consumed
        qc.invalidateQueries({ queryKey: queryKeys.pendingMessages(projectId, issueId) })
      },
      onDone: () => {
        qc.invalidateQueries({ queryKey: queryKeys.pendingMessages(projectId, issueId) })
      },
    })
    return unsub
  }, [projectId, issueId, qc])

  return useQuery({
    queryKey: queryKeys.pendingMessages(projectId, issueId ?? ''),
    queryFn: () => kanbanApi.getPendingMessages(projectId, issueId!),
    enabled: !!projectId && !!issueId,
  })
}

export function useInvalidatePendingMessages() {
  const qc = useQueryClient()
  return (projectId: string, issueId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.pendingMessages(projectId, issueId) })
}

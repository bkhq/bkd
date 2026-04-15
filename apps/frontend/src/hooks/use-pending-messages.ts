import { useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import { queryKeys } from './use-kanban'

export function usePendingMessages(projectId: string, issueId: string | null) {
  return useQuery({
    queryKey: queryKeys.pendingMessages(projectId, issueId ?? ''),
    queryFn: () => kanbanApi.getPendingMessages(projectId, issueId!),
    enabled: !!projectId && !!issueId,
    refetchInterval: 10_000,
  })
}

export function useInvalidatePendingMessages() {
  const qc = useQueryClient()
  return (projectId: string, issueId: string) =>
    qc.invalidateQueries({ queryKey: queryKeys.pendingMessages(projectId, issueId) })
}

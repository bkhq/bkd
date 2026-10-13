import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'

const decisionEventKeys = {
  all: ['decision-events'] as const,
}

/** Every decision event, kept fresh by the server's `decision-event-updated` signal. */
export function useDecisionEvents() {
  const qc = useQueryClient()
  useEffect(
    () => eventBus.onDecisionEventUpdated(() => {
      void qc.invalidateQueries({ queryKey: decisionEventKeys.all })
    }),
    [qc],
  )
  return useQuery({
    queryKey: decisionEventKeys.all,
    queryFn: kanbanApi.getDecisionEvents,
  })
}

/** Number of events still waiting on the user. */
export function useOpenDecisionCount(): number {
  const { data } = useDecisionEvents()
  return data?.filter(e => e.status === 'open').length ?? 0
}

export function useDecideDecisionEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string, optionId?: string | null, instruction?: string }) =>
      kanbanApi.decideDecisionEvent(id, data),
    onSettled: () => qc.invalidateQueries({ queryKey: decisionEventKeys.all }),
  })
}

export function useCloseDecisionEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string, reason?: string }) =>
      kanbanApi.closeDecisionEvent(id, reason),
    onSettled: () => qc.invalidateQueries({ queryKey: decisionEventKeys.all }),
  })
}

export function useNotifyDecisionEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.notifyDecisionEvent(id),
    onSettled: () => qc.invalidateQueries({ queryKey: decisionEventKeys.all }),
  })
}

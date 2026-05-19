import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryKeys } from '@/hooks/use-kanban'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'

export function useCockpitProposals() {
  const qc = useQueryClient()

  // Refresh on any cockpit-proposal SSE event
  useEffect(() => {
    return eventBus.onCockpitProposal(() => {
      qc.invalidateQueries({ queryKey: queryKeys.cockpitProposals() })
    })
  }, [qc])

  return useQuery({
    queryKey: queryKeys.cockpitProposals(),
    queryFn: () => kanbanApi.listCockpitProposals(),
    staleTime: 5000,
  })
}

export function useApproveCockpitProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.approveCockpitProposal(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cockpitProposals() })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({
        predicate: q => q.queryKey[0] === 'issues',
      })
    },
  })
}

export function useRejectCockpitProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.rejectCockpitProposal(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cockpitProposals() })
    },
  })
}

export function useCockpitReset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => kanbanApi.cockpitReset(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cockpitAssistant() })
    },
  })
}

export function useCockpitSetEngine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (engineType: string) => kanbanApi.cockpitSetEngine(engineType),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cockpitAssistant() })
      qc.invalidateQueries({
        predicate: q => q.queryKey[0] === 'projects' && q.queryKey.includes('issues'),
      })
    },
  })
}

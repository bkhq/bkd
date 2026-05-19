import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
import { STALE_TIME } from '@/lib/query-config'

export function useCockpitAssistant() {
  return useQuery({
    queryKey: queryKeys.cockpitAssistant(),
    queryFn: () => kanbanApi.getCockpitAssistant(),
    staleTime: STALE_TIME.STANDARD,
  })
}

export function useCockpitAsk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ prompt, model }: { prompt: string, model?: string }) =>
      kanbanApi.cockpitAsk(prompt, model),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cockpitAssistant() })
    },
  })
}

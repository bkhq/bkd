import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'

export function useIssueTemplates() {
  return useQuery({
    queryKey: queryKeys.issueTemplates(),
    queryFn: () => kanbanApi.listIssueTemplates(),
    staleTime: 5 * 60 * 1000,
  })
}

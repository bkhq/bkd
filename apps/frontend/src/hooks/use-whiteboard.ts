import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import type { WhiteboardNode } from '@/types/kanban'

export const whiteboardKeys = {
  all: (projectId: string) => ['whiteboard', projectId] as const,
}

export function useWhiteboardNodes(projectId: string) {
  return useQuery({
    queryKey: whiteboardKeys.all(projectId),
    queryFn: () => kanbanApi.getWhiteboardNodes(projectId),
    enabled: !!projectId,
  })
}

/**
 * Temporary client-side id assigned to optimistic nodes before the server
 * responds. Prefixed so consumers (e.g. auto-focus on newly created empty
 * nodes) can distinguish pending from persisted.
 */
export function isTempWhiteboardNodeId(id: string): boolean {
  return id.startsWith('tmp_')
}

export function useCreateWhiteboardNode(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      parentId?: string | null
      label?: string
      content?: string
      icon?: string
      sortOrder?: string
      metadata?: Record<string, unknown>
    }) => kanbanApi.createWhiteboardNode(projectId, data),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: whiteboardKeys.all(projectId) })
      const prev = qc.getQueryData<WhiteboardNode[]>(whiteboardKeys.all(projectId))
      const tempId = `tmp_${crypto.randomUUID()}`
      const now = new Date().toISOString()
      const optimistic: WhiteboardNode = {
        id: tempId,
        projectId,
        parentId: vars.parentId ?? null,
        label: vars.label ?? '',
        content: vars.content ?? '',
        icon: vars.icon ?? '',
        sortOrder: vars.sortOrder ?? 'a0',
        isCollapsed: false,
        metadata: vars.metadata ?? null,
        boundIssueId: null,
        createdAt: now,
        updatedAt: now,
      }
      qc.setQueryData<WhiteboardNode[]>(
        whiteboardKeys.all(projectId),
        prev ? [...prev, optimistic] : [optimistic],
      )
      return { prev, tempId }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(whiteboardKeys.all(projectId), ctx.prev)
    },
    onSuccess: (newNode, _vars, ctx) => {
      // Replace the temp placeholder with the real server row in-place so the
      // xyflow node identity flips from temp id to real id on the same render
      // instead of appearing to pop in.
      qc.setQueryData<WhiteboardNode[]>(whiteboardKeys.all(projectId), (list) => {
        if (!list) return [newNode]
        if (!ctx?.tempId) return [...list, newNode]
        const replaced = list.map(n => (n.id === ctx.tempId ? newNode : n))
        // If the temp id wasn't in the list (shouldn't happen), append.
        return replaced.some(n => n.id === newNode.id) ? replaced : [...replaced, newNode]
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all(projectId) }),
  })
}

export function useUpdateWhiteboardNode(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      nodeId,
      ...data
    }: {
      nodeId: string
      parentId?: string | null
      label?: string
      content?: string
      icon?: string
      sortOrder?: string
      isCollapsed?: boolean
      metadata?: Record<string, unknown>
      boundIssueId?: string | null
    }) => kanbanApi.updateWhiteboardNode(projectId, nodeId, data),
    onMutate: async ({ nodeId, ...data }) => {
      await qc.cancelQueries({ queryKey: whiteboardKeys.all(projectId) })
      const prev = qc.getQueryData<WhiteboardNode[]>(whiteboardKeys.all(projectId))
      if (prev) {
        qc.setQueryData<WhiteboardNode[]>(
          whiteboardKeys.all(projectId),
          prev.map(n => (n.id === nodeId ? { ...n, ...data } : n)),
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(whiteboardKeys.all(projectId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all(projectId) }),
  })
}

export function useDeleteWhiteboardNode(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: string) => kanbanApi.deleteWhiteboardNode(projectId, nodeId),
    onMutate: async (nodeId) => {
      await qc.cancelQueries({ queryKey: whiteboardKeys.all(projectId) })
      const prev = qc.getQueryData<WhiteboardNode[]>(whiteboardKeys.all(projectId))
      if (prev) {
        // Collect all descendant IDs to remove
        const childrenMap = new Map<string | null, string[]>()
        for (const n of prev) {
          const list = childrenMap.get(n.parentId)
          if (list) list.push(n.id)
          else childrenMap.set(n.parentId, [n.id])
        }
        const idsToRemove = new Set<string>()
        const queue = [nodeId]
        while (queue.length > 0) {
          const current = queue.pop()!
          idsToRemove.add(current)
          const children = childrenMap.get(current)
          if (children) queue.push(...children)
        }
        qc.setQueryData<WhiteboardNode[]>(
          whiteboardKeys.all(projectId),
          prev.filter(n => !idsToRemove.has(n.id)),
        )
      }
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(whiteboardKeys.all(projectId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all(projectId) }),
  })
}

export function useBulkUpdateWhiteboardNodes(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nodes: Array<{
      id: string
      parentId?: string | null
      sortOrder?: string
    }>) => kanbanApi.bulkUpdateWhiteboardNodes(projectId, nodes),
    onSettled: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all(projectId) }),
  })
}

export function useWhiteboardAsk(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      nodeId?: string
      prompt: string
      engineType?: string
      model?: string
    }) => kanbanApi.whiteboardAsk(projectId, data),
    onSettled: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all(projectId) }),
  })
}

export function useParseWhiteboardResponse(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { nodeId: string, issueId: string, skipInsert?: boolean }) =>
      kanbanApi.parseWhiteboardResponse(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: whiteboardKeys.all(projectId) }),
  })
}

export function useGenerateIssuesFromNodes(projectId: string) {
  return useMutation({
    mutationFn: (data: { nodeIds: string[] }) =>
      kanbanApi.generateIssuesFromNodes(projectId, data),
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import type { Note } from '@/types/kanban'

const notesKeys = {
  all: ['notes'] as const,
  list: (opts?: { projectId?: string, archived?: boolean }) =>
    [...notesKeys.all, 'list', opts] as const,
}

export function useNotes(opts?: { projectId?: string, archived?: boolean }) {
  return useQuery({
    queryKey: notesKeys.list(opts),
    queryFn: () => kanbanApi.getNotes(opts),
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      title?: string
      content?: string
      projectId?: string
      issueId?: string
      source?: 'manual' | 'ai-summary' | 'ai-pattern'
      tags?: string[]
    }) => kanbanApi.createNote(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKeys.all }),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string
      title?: string
      content?: string
      isPinned?: boolean
      isArchived?: boolean
      tags?: string[]
    }) => kanbanApi.updateNote(id, data),
    onMutate: async ({ id, ...data }) => {
      await qc.cancelQueries({ queryKey: notesKeys.all })
      const prev = qc.getQueryData<Note[]>(notesKeys.all)
      if (prev) {
        qc.setQueryData<Note[]>(
          notesKeys.all,
          prev.map(n => (n.id === id ? { ...n, ...data } : n)),
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(notesKeys.all, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notesKeys.all }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.deleteNote(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: notesKeys.all })
      const prev = qc.getQueryData<Note[]>(notesKeys.all)
      if (prev) {
        qc.setQueryData<Note[]>(
          notesKeys.all,
          prev.filter(n => n.id !== id),
        )
      }
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(notesKeys.all, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: notesKeys.all }),
  })
}

export function useQueryNotes() {
  return useMutation({
    mutationFn: (data: { prompt: string, projectId?: string, limit?: number }) =>
      kanbanApi.queryNotes(data),
  })
}

export function useSummarizeIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { projectId: string, issueId: string }) =>
      kanbanApi.summarizeIssue(data.projectId, data.issueId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notesKeys.all })
    },
  })
}

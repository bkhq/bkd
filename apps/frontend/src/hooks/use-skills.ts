import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import type { SkillLocation } from '@/types/kanban'

export const skillsKeys = {
  all: ['skills'] as const,
  list: (projectId?: string) => ['skills', 'list', projectId ?? ''] as const,
  files: (location: SkillLocation, name: string, projectId?: string) => ['skills', 'files', location, name, projectId ?? ''] as const,
  file: (location: SkillLocation, name: string, path: string, projectId?: string) => ['skills', 'file', location, name, path, projectId ?? ''] as const,
}

export function useSkills(projectId?: string) {
  return useQuery({
    queryKey: skillsKeys.list(projectId),
    queryFn: () => kanbanApi.getSkills(projectId),
  })
}

export function useSkillFiles(location: SkillLocation | undefined, name: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: skillsKeys.files(location ?? 'global-agents', name ?? '', projectId),
    queryFn: () => kanbanApi.getSkillFiles(location!, name!, projectId),
    enabled: !!location && !!name,
  })
}

export function useSkillFile(location: SkillLocation | undefined, name: string | undefined, path: string | undefined, projectId?: string) {
  return useQuery({
    queryKey: skillsKeys.file(location ?? 'global-agents', name ?? '', path ?? '', projectId),
    queryFn: () => kanbanApi.getSkillFile(location!, name!, path!, projectId),
    enabled: !!location && !!name && !!path,
    // An open editor must not be overwritten by a background refetch
    staleTime: Infinity,
  })
}

export function useSaveSkillFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ location, name, ...data }: { location: SkillLocation, name: string, path: string, content: string, projectId?: string }) =>
      kanbanApi.saveSkillFile(location, name, data),
    onSuccess: (file, { location, name, projectId }) => {
      qc.setQueryData(skillsKeys.file(location, name, file.path, projectId), file)
      void qc.invalidateQueries({ queryKey: skillsKeys.files(location, name, projectId) })
      void qc.invalidateQueries({ queryKey: skillsKeys.list(projectId) })
    },
  })
}

export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: kanbanApi.createSkill,
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKeys.all }),
  })
}

export function useCopySkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ location, name, newName, projectId }: { location: SkillLocation, name: string, newName: string, projectId?: string }) =>
      kanbanApi.copySkill(location, name, { name: newName, projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKeys.all }),
  })
}

export function useDeleteSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ location, name, projectId }: { location: SkillLocation, name: string, projectId?: string }) =>
      kanbanApi.deleteSkill(location, name, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKeys.all }),
  })
}

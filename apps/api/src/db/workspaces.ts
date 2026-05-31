import { and, asc, eq } from 'drizzle-orm'
import { db } from '.'
import { projects, workspaces } from './schema'
import { toISO } from '@/utils/date'

type WorkspaceRow = typeof workspaces.$inferSelect

export function serializeWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    repos: JSON.parse(row.repos) as { url: string, defaultBranch: string, role: string }[],
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

export async function findWorkspace(id: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.isDeleted, 0)))
  return row ?? null
}

export async function listWorkspaces() {
  return db
    .select()
    .from(workspaces)
    .where(eq(workspaces.isDeleted, 0))
    .orderBy(asc(workspaces.createdAt))
}

export async function createWorkspace(data: {
  name: string
  description?: string
  repos?: { url: string, defaultBranch: string, role: string }[]
}) {
  const [row] = await db
    .insert(workspaces)
    .values({
      name: data.name,
      description: data.description ?? null,
      repos: data.repos ? JSON.stringify(data.repos) : '[]',
    })
    .returning()
  return row!
}

export async function updateWorkspace(
  id: string,
  data: { name?: string, description?: string, repos?: { url: string, defaultBranch: string, role: string }[] },
) {
  const updates: Record<string, unknown> = {}
  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.repos !== undefined) updates.repos = JSON.stringify(data.repos)

  if (Object.keys(updates).length === 0) return null

  const [row] = await db
    .update(workspaces)
    .set(updates)
    .where(eq(workspaces.id, id))
    .returning()
  return row ?? null
}

export async function deleteWorkspace(id: string) {
  await db
    .update(workspaces)
    .set({ isDeleted: 1 })
    .where(eq(workspaces.id, id))
}

export async function getWorkspaceProjects(workspaceId: string) {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.isDeleted, 0)))
    .orderBy(asc(projects.sortOrder))
}

export async function linkProjectToWorkspace(workspaceId: string, projectId: string) {
  const [row] = await db
    .update(projects)
    .set({ workspaceId })
    .where(and(eq(projects.id, projectId), eq(projects.isDeleted, 0)))
    .returning()
  return row ?? null
}

export async function unlinkProjectFromWorkspace(projectId: string) {
  const [row] = await db
    .update(projects)
    .set({ workspaceId: null })
    .where(and(eq(projects.id, projectId), eq(projects.isDeleted, 0)))
    .returning()
  return row ?? null
}

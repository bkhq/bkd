import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import {
  createWorkspace,
  deleteWorkspace,
  findWorkspace,
  getWorkspaceProjects,
  linkProjectToWorkspace,
  listWorkspaces,
  serializeWorkspace,
  unlinkProjectFromWorkspace,
  updateWorkspace,
} from '@/db/workspaces'
import { findProject } from '@/db/helpers'

const workspaces = createOpenAPIRouter()

workspaces.openapi(R.listWorkspaces, async (c) => {
  const rows = await listWorkspaces()
  return c.json({ success: true, data: rows.map(serializeWorkspace) }, 200 as const)
})

workspaces.openapi(R.createWorkspace, async (c) => {
  const body = c.req.valid('json')
  const row = await createWorkspace({
    name: body.name,
    description: body.description,
    repos: body.repos,
  })
  return c.json({ success: true, data: serializeWorkspace(row) }, 201 as const)
})

workspaces.openapi(R.getWorkspace, async (c) => {
  const row = await findWorkspace(c.req.param('workspaceId'))
  if (!row) {
    return c.json({ success: false, error: 'Workspace not found' }, 404 as const)
  }
  return c.json({ success: true, data: serializeWorkspace(row) }, 200 as const)
})

workspaces.openapi(R.updateWorkspace, async (c) => {
  const body = c.req.valid('json')
  const existing = await findWorkspace(c.req.param('workspaceId'))
  if (!existing) {
    return c.json({ success: false, error: 'Workspace not found' }, 404 as const)
  }
  const row = await updateWorkspace(existing.id, {
    name: body.name,
    description: body.description,
    repos: body.repos,
  })
  if (!row) {
    return c.json({ success: true, data: serializeWorkspace(existing) }, 200 as const)
  }
  return c.json({ success: true, data: serializeWorkspace(row) }, 200 as const)
})

workspaces.openapi(R.deleteWorkspace, async (c) => {
  const existing = await findWorkspace(c.req.param('workspaceId'))
  if (!existing) {
    return c.json({ success: false, error: 'Workspace not found' }, 404 as const)
  }
  await deleteWorkspace(existing.id)
  return c.json({ success: true, data: { id: existing.id } }, 200 as const)
})

workspaces.openapi(R.getWorkspaceProjects, async (c) => {
  const existing = await findWorkspace(c.req.param('workspaceId'))
  if (!existing) {
    return c.json({ success: false, error: 'Workspace not found' }, 404 as const)
  }
  const rows = await getWorkspaceProjects(existing.id)
  // serializeProject is not in scope here — return raw rows with toISO
  const { toISO } = await import('@/utils/date')
  const data = rows.map(row => ({
    id: row.id,
    alias: row.alias,
    name: row.name,
    description: row.description ?? undefined,
    directory: row.directory ?? undefined,
    repositoryUrl: row.repositoryUrl ?? undefined,
    systemPrompt: row.systemPrompt ?? undefined,
    envVars: row.envVars ? (JSON.parse(row.envVars) as Record<string, string>) : undefined,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived === 1,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }))
  return c.json({ success: true, data }, 200 as const)
})

workspaces.openapi(R.linkProjectToWorkspace, async (c) => {
  const { workspaceId, projectId } = c.req.param()
  const ws = await findWorkspace(workspaceId)
  if (!ws) {
    return c.json({ success: false, error: 'Workspace not found' }, 404 as const)
  }
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }
  const row = await linkProjectToWorkspace(ws.id, project.id)
  if (!row) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }
  const { toISO } = await import('@/utils/date')
  return c.json({
    success: true,
    data: {
      id: row.id,
      alias: row.alias,
      name: row.name,
      description: row.description ?? undefined,
      directory: row.directory ?? undefined,
      repositoryUrl: row.repositoryUrl ?? undefined,
      systemPrompt: row.systemPrompt ?? undefined,
      envVars: row.envVars ? (JSON.parse(row.envVars) as Record<string, string>) : undefined,
      sortOrder: row.sortOrder,
      isArchived: row.isArchived === 1,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
    },
  }, 200 as const)
})

workspaces.openapi(R.unlinkProjectFromWorkspace, async (c) => {
  const { workspaceId, projectId } = c.req.param()
  if (!(await findWorkspace(workspaceId))) {
    return c.json({ success: false, error: 'Workspace not found' }, 404 as const)
  }
  const row = await unlinkProjectFromWorkspace(projectId)
  if (!row) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }
  const { toISO } = await import('@/utils/date')
  return c.json({
    success: true,
    data: {
      id: row.id,
      alias: row.alias,
      name: row.name,
      description: row.description ?? undefined,
      directory: row.directory ?? undefined,
      repositoryUrl: row.repositoryUrl ?? undefined,
      systemPrompt: row.systemPrompt ?? undefined,
      envVars: row.envVars ? (JSON.parse(row.envVars) as Record<string, string>) : undefined,
      sortOrder: row.sortOrder,
      isArchived: row.isArchived === 1,
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
    },
  }, 200 as const)
})

export default workspaces

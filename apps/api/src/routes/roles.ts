import { and, eq } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { db } from '@/db'
import { rolesTable } from '@/db/schema'
import { ulid } from 'ulid'

const roles = createOpenAPIRouter()

// GET /api/projects/:projectId/roles
roles.openapi(R.listRoles, async (c) => {
  const projectId = c.req.param('projectId')!
  const list = await db.select().from(rolesTable).where(and(
    eq(rolesTable.projectId, projectId),
    eq(rolesTable.isDeleted, 0),
  ))
  return c.json({ success: true, data: list }, 200)
})

// POST /api/projects/:projectId/roles
roles.openapi(R.createRole, async (c) => {
  const projectId = c.req.param('projectId')!
  const body = c.req.valid('json')

  const [existing] = await db.select().from(rolesTable).where(and(
    eq(rolesTable.projectId, projectId),
    eq(rolesTable.name, body.name),
    eq(rolesTable.isDeleted, 0),
  ))

  if (existing) {
    return c.json({ success: false, error: 'Role name already exists' }, 409)
  }

  const role = {
    id: ulid(),
    projectId,
    ...body,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: 0,
  }

  await db.insert(rolesTable).values(role)
  return c.json({ success: true, data: role }, 201)
})

// GET /api/projects/:projectId/roles/:roleId
roles.openapi(R.getRole, async (c) => {
  const projectId = c.req.param('projectId')!
  const roleId = c.req.param('roleId')!
  const [role] = await db.select().from(rolesTable).where(and(
    eq(rolesTable.id, roleId),
    eq(rolesTable.projectId, projectId),
    eq(rolesTable.isDeleted, 0),
  ))

  if (!role) {
    return c.json({ success: false, error: 'Role not found' }, 404)
  }

  return c.json({ success: true, data: role }, 200)
})

// PATCH /api/projects/:projectId/roles/:roleId
roles.openapi(R.updateRole, async (c) => {
  const projectId = c.req.param('projectId')!
  const roleId = c.req.param('roleId')!
  const body = c.req.valid('json')

  const [existing] = await db.select().from(rolesTable).where(and(
    eq(rolesTable.id, roleId),
    eq(rolesTable.projectId, projectId),
    eq(rolesTable.isDeleted, 0),
  ))

  if (!existing) {
    return c.json({ success: false, error: 'Role not found' }, 404)
  }

  await db.update(rolesTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(rolesTable.id, roleId))

  const [updated] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId))

  return c.json({ success: true, data: updated }, 200)
})

// DELETE /api/projects/:projectId/roles/:roleId
roles.openapi(R.deleteRole, async (c) => {
  const projectId = c.req.param('projectId')!
  const roleId = c.req.param('roleId')!

  const [existing] = await db.select().from(rolesTable).where(and(
    eq(rolesTable.id, roleId),
    eq(rolesTable.projectId, projectId),
    eq(rolesTable.isDeleted, 0),
  ))

  if (!existing) {
    return c.json({ success: false, error: 'Role not found' }, 404)
  }

  await db.update(rolesTable)
    .set({ isDeleted: 1, updatedAt: new Date() })
    .where(eq(rolesTable.id, roleId))

  return c.json({ success: true, data: null }, 200)
})

export default roles

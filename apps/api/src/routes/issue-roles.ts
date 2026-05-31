import { and, eq } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { db, issueRoles, rolesTable } from '@/db'
import { ulid } from 'ulid'

const issueRolesRouter = createOpenAPIRouter()

// POST /api/projects/:pid/issues/:id/roles - Assign role
issueRolesRouter.openapi(R.assignRole, async (c) => {
  const projectId = c.req.param('projectId')!
  const issueId = c.req.param('issueId')!
  const body = c.req.valid('json')

  // Check if already assigned
  const [existing] = await db.select().from(issueRoles).where(and(
    eq(issueRoles.issueId, issueId),
    eq(issueRoles.roleId, body.roleId),
    eq(issueRoles.isDeleted, 0),
  ))

  if (existing) {
    return c.json({ success: false, error: 'Role already assigned' }, 409)
  }

  const assignment = {
    id: ulid(),
    issueId,
    roleId: body.roleId,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: 0,
  }

  await db.insert(issueRoles).values(assignment)
  return c.json({ success: true, data: assignment }, 201)
})

// DELETE /api/projects/:pid/issues/:id/roles/:roleId - Remove role
issueRolesRouter.openapi(R.removeRole, async (c) => {
  const issueId = c.req.param('issueId')!
  const roleId = c.req.param('roleId')!

  const [existing] = await db.select().from(issueRoles).where(and(
    eq(issueRoles.issueId, issueId),
    eq(issueRoles.roleId, roleId),
    eq(issueRoles.isDeleted, 0),
  ))

  if (!existing) {
    return c.json({ success: false, error: 'Role not assigned' }, 404)
  }

  await db.update(issueRoles)
    .set({ isDeleted: 1, updatedAt: new Date() })
    .where(eq(issueRoles.id, existing.id))

  return c.json({ success: true, data: null }, 200)
})

// GET /api/projects/:pid/issues/:id/roles - List assigned roles
issueRolesRouter.openapi(R.listIssueRoles, async (c) => {
  const issueId = c.req.param('issueId')!

  const assignments = await db.select({
    role: rolesTable,
  }).from(issueRoles).innerJoin(rolesTable, eq(issueRoles.roleId, rolesTable.id)).where(and(
    eq(issueRoles.issueId, issueId),
    eq(issueRoles.isDeleted, 0),
    eq(rolesTable.isDeleted, 0),
  ))

  const roles = assignments.map(a => a.role)
  return c.json({ success: true, data: roles }, 200)
})

// GET /api/projects/:pid/issues/:id/participants - List participants
issueRolesRouter.get('/:issueId/participants', async (c) => {
  const issueId = c.req.param('issueId')!

  const roleAssignments = await db.select({
    role: rolesTable,
  }).from(issueRoles).innerJoin(rolesTable, eq(issueRoles.roleId, rolesTable.id)).where(and(
    eq(issueRoles.issueId, issueId),
    eq(issueRoles.isDeleted, 0),
    eq(rolesTable.isDeleted, 0),
  ))

  return c.json({
    success: true,
    data: {
      humans: [],
      roles: roleAssignments.map(a => a.role),
    },
  }, 200)
})

export default issueRolesRouter

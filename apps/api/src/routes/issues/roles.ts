import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { db } from '@/db'
import { issueLogs } from '@/db/schema'
import { ulid } from 'ulid'

const issueRoles = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:issueId/roles/:roleId/invoke
issueRoles.openapi(R.invokeRole, async (c) => {
  const projectId = c.req.param('projectId')!
  const issueId = c.req.param('issueId')!
  const body = c.req.valid('json')

  try {
    const { invokeRole } = await import('@/engines/issue/role-invoke')
    const result = await invokeRole({
      projectId,
      issueId,
      roleName: body.roleName,
      message: body.message,
      context: body.context,
    })

    return c.json({ success: true, data: result }, 200)
  } catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400)
  }
})

// POST /api/projects/:projectId/issues/:issueId/roles/reply
issueRoles.openapi(R.roleReply, async (c) => {
  const { issueId } = c.req.param()
  const body = c.req.valid('json')

  // TODO: 验证来源（token 或 IP）

  const logEntry = {
    id: ulid(),
    issueId,
    turnIndex: 0,
    entryIndex: 0,
    entryType: 'assistant-message',
    content: body.message,
    metadata: JSON.stringify({
      role: body.role,
      isRoleReply: true,
    }),
    visible: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  await db.insert(issueLogs).values(logEntry)

  return c.json({ success: true, data: logEntry }, 200)
})

export default issueRoles

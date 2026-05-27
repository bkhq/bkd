import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueRoles, issues, rolesTable } from '@/db/schema'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { issueEngine } from './engine'

interface InvokeRoleOptions {
  projectId: string
  issueId: string
  roleName: string
  message: string
  context?: string
}

export async function invokeRole({ projectId, issueId, roleName, message, context }: InvokeRoleOptions) {
  const [role] = await db.select().from(rolesTable).where(and(
    eq(rolesTable.projectId, projectId),
    eq(rolesTable.name, roleName),
    eq(rolesTable.isDeleted, 0),
  ))

  if (!role) {
    throw new Error(`Role '${roleName}' not found`)
  }

  if (role.type === 'internal') {
    if (!role.issueId) {
      throw new Error(`Internal role '${roleName}' has no associated issue`)
    }

    const [targetIssue] = await db.select().from(issues).where(and(
      eq(issues.id, role.issueId),
      eq(issues.projectId, projectId),
    ))

    if (!targetIssue) {
      throw new Error(`Issue for internal role '${roleName}' not found`)
    }

    const prompt = context
      ? `${context}\n\n请你：${message}`
      : message

    const result = await issueEngine.executeIssue(role.issueId, {
      engineType: (targetIssue.engineType ?? 'claude-code') as EngineType,
      prompt,
    })

    // Async: write back result + recursive trigger
    const { writeBackResult } = await import('./role-callback')
    writeBackResult({
      sourceIssueId: role.issueId,
      targetIssueId: issueId,
      roleName,
      executionId: result.executionId,
      projectId,
    }).catch((err) => {
      logger.warn({ roleName, issueId, error: err.message }, 'write_back_failed')
    })

    return {
      type: 'internal' as const,
      roleId: role.id,
      executionId: result.executionId,
    }
  } else {
    if (!role.endpoint) {
      throw new Error(`External role '${roleName}' has no endpoint`)
    }

    const response = await fetch(`${role.endpoint}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: role.name,
        projectId,
        issueId,
        context,
        message,
      }),
    })

    if (!response.ok) {
      throw new Error(`External role '${roleName}' returned ${response.status}`)
    }

    return {
      type: 'external' as const,
      roleId: role.id,
    }
  }
}

export function parseMentions(message: string): string[] {
  const mentions: string[] = []
  const regex = /@(\w+)/g
  let match
  while ((match = regex.exec(message)) !== null) {
    mentions.push(match[1])
  }
  return [...new Set(mentions)]
}

export async function isRoleAssigned(issueId: string, roleName: string): Promise<boolean> {
  const [role] = await db.select().from(rolesTable).where(and(
    eq(rolesTable.name, roleName),
    eq(rolesTable.isDeleted, 0),
  ))

  if (!role) return false

  const [assignment] = await db.select().from(issueRoles).where(and(
    eq(issueRoles.issueId, issueId),
    eq(issueRoles.roleId, role.id),
    eq(issueRoles.isDeleted, 0),
  ))

  return !!assignment
}

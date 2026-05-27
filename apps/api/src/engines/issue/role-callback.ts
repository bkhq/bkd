import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs } from '@/db/schema'
import { ulid } from 'ulid'
import { logger } from '@/logger'

// Call chain tracking for loop prevention
const invocationChains = new Map<string, string[]>()

export async function writeBackResult({
  sourceIssueId, // expert issue where role executed
  targetIssueId, // chatroom issue where result should be written
  roleName,
  executionId,
  projectId,
}: {
  sourceIssueId: string
  targetIssueId: string
  roleName: string
  executionId: string
  projectId: string
}) {
  try {
    // 1. Get the last assistant-message from the expert issue
    const [reply] = await db.select().from(issueLogs).where(
      and(
        eq(issueLogs.issueId, sourceIssueId),
        eq(issueLogs.entryType, 'assistant-message'),
      ),
    ).orderBy(desc(issueLogs.createdAt)).limit(1)

    if (!reply) {
      logger.warn({ sourceIssueId, roleName }, 'no_assistant_message_found')
      return
    }

    // 2. Write result back to chatroom
    const logId = ulid()
    await db.insert(issueLogs).values({
      id: logId,
      issueId: targetIssueId,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'assistant-message',
      content: reply.content,
      metadata: JSON.stringify({
        role: roleName,
        isRoleReply: true,
        sourceExecutionId: executionId,
      }),
      visible: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 3. Notify frontend via SSE
    const { emitIssueLogAdded } = await import('@/events/issue-events')
    emitIssueLogAdded(targetIssueId, logId)

    // 4. Parse @mentions in the result and trigger recursively
    const { parseMentions } = await import('./role-invoke')
    const mentions = parseMentions(reply.content)

    for (const mentionedRole of mentions) {
      if (mentionedRole === roleName) continue // Don't trigger self

      // Check if role is assigned to this chatroom
      const { isRoleAssigned } = await import('./role-invoke')
      if (await isRoleAssigned(targetIssueId, mentionedRole)) {
        if (!isLoopDetected(targetIssueId, mentionedRole)) {
          recordInvocation(targetIssueId, roleName, mentionedRole)

          const { invokeRole } = await import('./role-invoke')
          await invokeRole({
            projectId,
            issueId: targetIssueId,
            roleName: mentionedRole,
            message: reply.content,
          }).catch((err) => {
            logger.warn({ mentionedRole, targetIssueId, error: err.message }, 'role_invocation_failed')
          })
        }
      }
    }
  } catch (error) {
    logger.error({ sourceIssueId, targetIssueId, roleName, error }, 'write_back_failed')
  }
}

export function isLoopDetected(issueId: string, toRole: string): boolean {
  const chain = invocationChains.get(issueId) || []

  // Same role can be triggered at most 2 times in one chain
  const count = chain.filter(r => r === toRole).length
  if (count >= 2) return true

  // Max chain depth: 10
  if (chain.length >= 10) return true

  return false
}

export function recordInvocation(issueId: string, fromRole: string, toRole: string) {
  const chain = invocationChains.get(issueId) || []
  chain.push(toRole)
  invocationChains.set(issueId, chain)
}

export function clearInvocationChain(issueId: string) {
  invocationChains.delete(issueId)
}

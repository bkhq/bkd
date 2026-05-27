import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs } from '@/db/schema'
import { issueEngine } from './engine'
import { logger } from '@/logger'

export async function invokeHost(issueId: string, message: string) {
  try {
    // 1. Get chatroom conversation history
    const logs = await db
      .select()
      .from(issueLogs)
      .where(
        eq(issueLogs.issueId, issueId),
      )
      .orderBy(asc(issueLogs.createdAt))

    // 2. Build prompt from pure history (NO systemPrompt)
    const history = logs
      .map((log) => {
        const metadata = log.metadata ? JSON.parse(log.metadata) : {}
        const isHost = metadata.isHost
        const role = metadata.role
        const speaker = isHost ? '主持人' : (role || '用户')
        return `${speaker}: ${log.content}`
      })
      .join('\n\n')

    const prompt = `${history}\n\n用户: ${message}\n\n主持人:`

    // 3. Execute in the chatroom issue itself (no expert issue)
    // The host is the chatroom itself
    const result = await issueEngine.executeIssue(issueId, {
      engineType: 'claude-code',
      prompt,
    })

    logger.info({ issueId, executionId: result.executionId }, 'host_executed')
  } catch (error) {
    logger.error({ issueId, error }, 'host_execution_failed')
  }
}

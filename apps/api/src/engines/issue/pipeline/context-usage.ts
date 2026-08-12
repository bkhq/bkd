import type { AppEventMap } from '@bkd/shared'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { issues } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import type { EngineContext } from '../context'

/**
 * Order 16 — Live context-window usage (claude-code only).
 *
 * - `token-usage` entries (from message_delta usage) carry the current
 *   context size: input (incl. cache read/creation) + output tokens.
 * - result entries (`turnCompleted`) carry `modelUsage` with the model's
 *   `contextWindow`.
 *
 * Updates `issues.contextTokens` / `issues.contextWindow` and emits a
 * `context-usage` app event for SSE forwarding.
 */
export function registerContextUsageStage(
  ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      const engineType = ctx.pm.get(data.executionId)?.meta.engineType
      if (engineType !== 'claude-code') return

      const meta = data.entry.metadata
      if (!meta) return

      let contextTokens: number | undefined
      let contextWindow: number | undefined

      if (data.entry.entryType === 'token-usage') {
        const input = typeof meta.inputTokens === 'number' ? meta.inputTokens : 0
        const output = typeof meta.outputTokens === 'number' ? meta.outputTokens : 0
        if (input + output > 0) contextTokens = input + output
      } else if (meta.turnCompleted && meta.modelUsage && typeof meta.modelUsage === 'object') {
        for (const usage of Object.values(meta.modelUsage as Record<string, unknown>)) {
          const cw = (usage as { contextWindow?: unknown })?.contextWindow
          if (typeof cw === 'number' && cw > 0) {
            contextWindow = Math.max(contextWindow ?? 0, cw)
          }
        }
      }

      if (contextTokens === undefined && contextWindow === undefined) return

      try {
        db.update(issues)
          .set({
            ...(contextTokens !== undefined && { contextTokens }),
            ...(contextWindow !== undefined && { contextWindow }),
          })
          .where(sql`${issues.id} = ${data.issueId}`)
          .run()

        const row = db
          .select({ contextTokens: issues.contextTokens, contextWindow: issues.contextWindow })
          .from(issues)
          .where(sql`${issues.id} = ${data.issueId}`)
          .get()
        if (row) {
          appEvents.emit('context-usage', {
            issueId: data.issueId,
            contextTokens: row.contextTokens,
            contextWindow: row.contextWindow,
          })
        }
      } catch (error) {
        logger.warn({ issueId: data.issueId, error }, 'context_usage_update_failed')
      }
    },
    { order: 16 },
  )
}

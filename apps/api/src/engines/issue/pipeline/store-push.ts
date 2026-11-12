import type { AppEventMap } from '@bkd/shared'
import type { EngineContext } from '../context'

/**
 * Order 20 — pushes non-streaming entries into the execution's in-memory
 * store so `getLogs()` can merge DB + recent entries.
 */
export function registerStorePushStage(
  ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return
      const managed = ctx.pm.get(data.executionId)?.meta
      if (managed) managed.logs.push(data.entry)
    },
    { order: 20 },
  )
}

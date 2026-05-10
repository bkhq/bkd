import { appEvents } from '@/events'
import type { EngineContext } from '../context'
import { registerFailureDetectStage } from './failure-detect'
import { registerPersistStage } from './persist'
import { registerRingBufferStage } from './ring-buffer'
import { registerTimelineEmitStage } from './timeline-emit'
import { registerTokenUsageStage } from './token-usage'

/**
 * Register all log-entry pipeline stages on the global event bus.
 *
 * Each stage is an independent ordered subscriber:
 *   order 10   — DB persistence + messageId enrichment  (persist.ts)
 *   order 15   — token usage accumulation               (token-usage.ts)
 *   order 20   — ring buffer push                       (ring-buffer.ts)
 *   order 40   — logical failure detection              (failure-detect.ts)
 *   order 90   — timeline conversion + visibility/streaming gate (timeline-emit.ts)
 *                emits 'timeline-entry' events for SSE consumption
 *   order 100  — (none) — SSE subscribes to 'timeline-entry' instead of 'log'
 *
 * Visibility/streaming filtering moved into the timeline-emit stage so DB
 * persistence and failure detection still see ALL raw entries while clients
 * only receive what's renderable.
 *
 * Stages are isolated: a failure in one does not block subsequent stages.
 * In particular, DB persistence failure no longer prevents SSE delivery.
 */
export function registerLogPipeline(ctx: EngineContext): void {
  const on = (cb: Parameters<typeof appEvents.on<'log'>>[1], opts: { order: number }) =>
    appEvents.on('log', cb, opts)

  registerPersistStage(ctx, on)
  registerTokenUsageStage(ctx, on)
  registerRingBufferStage(ctx, on)
  registerFailureDetectStage(ctx, on)
  registerTimelineEmitStage(ctx, on)
}

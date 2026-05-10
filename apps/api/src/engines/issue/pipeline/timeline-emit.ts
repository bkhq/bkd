import type { AppEventMap } from '@bkd/shared'
import { isVisible } from '@/engines/issue/utils/visibility'
import { liveConverter } from '@/engines/timeline-converter'
import { appEvents } from '@/events'
import type { EngineContext } from '../context'

/**
 * Order 90 — Timeline conversion stage.
 *
 * Runs each NormalizedLogEntry through the per-issue stateful TimelineConverter
 * exactly once (regardless of how many SSE clients are connected) and re-emits
 * the produced TimelineEntries on the `timeline-entry` channel.
 *
 * Why a pipeline stage and not the SSE handler?
 *   The SSE handler runs per-connection. If conversion happened there,
 *   N connected clients would advance the converter's internal state N times
 *   per log entry — sequence numbers would inflate, segment counters would
 *   drift, and clients would diverge.
 *
 * Streaming and visibility gates moved here so this stage matches the SSE
 * subscriber's input filter: SSE simply forwards `timeline-entry` events.
 */
export function registerTimelineEmitStage(
  _ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      // `dbOnly` entries are the merged final-content snapshots produced by
      // engine normalizers (currently ACP's `flushAssistantMessage` /
      // `flushThinkingMessage` at `acp-prompt-result`). They exist solely so
      // the persist stage (order 10) can land the full merged content in
      // `issue_logs` — streaming chunks themselves are dropped there. Letting
      // them re-enter `liveConverter.ingest` here would open a fresh segment
      // next to the streaming buffer that already holds the same content,
      // producing duplicate assistant/thinking bubbles per turn. See PLAN-009.
      if (data.entry.metadata?.dbOnly === true) return

      // Tool-use streaming updates are dropped — only the final non-streaming
      // tool entry reaches clients. Assistant + thinking streaming chunks pass
      // so users see real-time generation.
      if (
        data.streaming
        && data.entry.entryType !== 'assistant-message'
        && data.entry.entryType !== 'thinking'
      ) {
        return
      }
      if (!isVisible(data.entry)) return

      const produced = liveConverter.ingest(data.issueId, data.entry)
      for (const e of produced) {
        appEvents.emit('timeline-entry', { issueId: data.issueId, entry: e })
      }
    },
    { order: 90 },
  )
}

/**
 * Flush any pending streaming buffers and reset converter state for the issue.
 * Called when an issue settles so the last in-flight thinking/assistant
 * segment lands on clients before the `done` event arrives.
 */
export function flushTimelineConverter(issueId: string): void {
  const tail = liveConverter.flush(issueId)
  for (const e of tail) {
    appEvents.emit('timeline-entry', { issueId, entry: e })
  }
  liveConverter.reset(issueId)
}

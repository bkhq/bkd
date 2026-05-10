import type { AppEventMap } from '@bkd/shared'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { liveConverter } from '@/engines/timeline-converter'
import { appEvents } from '@/events'
import type { EngineContext } from '../context'
import { registerTimelineEmitStage } from './timeline-emit'

// ────────────────────────────────────────────────────────────────────────────
// CHAT-003 / PLAN-009 — `dbOnly` lane
//
// The timeline-emit stage MUST early-return on entries flagged
// `metadata.dbOnly === true`. Those entries are produced by engine
// normalizers (currently ACP's `flushAssistantMessage` / `flushThinkingMessage`
// at `acp-prompt-result`) so the persist stage (order 10) can land the merged
// final assistant/thinking content in `issue_logs`. The streaming buffer in
// `liveConverter` already has the same content from the per-chunk feed, so
// re-ingesting the dbOnly entry would open a duplicate `turn-N-assistant-NNNN`
// segment and the user would see two bubbles per turn (raw streaming + final
// markdown).
// ────────────────────────────────────────────────────────────────────────────

const TEST_ISSUE_ID = 'chat003-test-issue'

function makeStubContext(): EngineContext {
  // Only `_ctx` placeholder is needed — the stage doesn't dereference it.
  return {} as unknown as EngineContext
}

describe('registerTimelineEmitStage — dbOnly skipping (CHAT-003)', () => {
  let unregisterStage: () => void
  let unregisterListener: () => void
  let captured: AppEventMap['timeline-entry'][]

  beforeEach(() => {
    liveConverter.reset(TEST_ISSUE_ID)
    captured = []
    unregisterStage = registerTimelineEmitStage(
      makeStubContext(),
      (cb, opts) => appEvents.on('log', cb, opts),
    )
    unregisterListener = appEvents.on('timeline-entry', (data) => {
      if (data.issueId === TEST_ISSUE_ID) captured.push(data)
    })
  })

  afterEach(() => {
    unregisterStage()
    unregisterListener()
    liveConverter.reset(TEST_ISSUE_ID)
  })

  test('drops entries flagged metadata.dbOnly === true (no timeline-entry emitted)', () => {
    appEvents.emit('log', {
      issueId: TEST_ISSUE_ID,
      executionId: 'exec-1',
      streaming: false,
      entry: {
        entryType: 'assistant-message',
        content: 'merged final content from acp-prompt-result',
        timestamp: '2026-05-10T00:00:00.000Z',
        turnIndex: 0,
        metadata: { dbOnly: true },
      },
    })

    expect(captured).toHaveLength(0)
  })

  test('drops dbOnly thinking entries the same way', () => {
    appEvents.emit('log', {
      issueId: TEST_ISSUE_ID,
      executionId: 'exec-1',
      streaming: false,
      entry: {
        entryType: 'thinking',
        content: 'merged thinking from acp-prompt-result',
        timestamp: '2026-05-10T00:00:00.000Z',
        turnIndex: 0,
        metadata: { dbOnly: true },
      },
    })

    expect(captured).toHaveLength(0)
  })

  test('still emits timeline-entry for normal (non-dbOnly) assistant entries', () => {
    appEvents.emit('log', {
      issueId: TEST_ISSUE_ID,
      executionId: 'exec-1',
      streaming: true,
      entry: {
        entryType: 'assistant-message',
        content: 'streaming chunk',
        timestamp: '2026-05-10T00:00:00.000Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    })

    // At least one timeline-entry surfaces (the streaming buffer snapshot
    // from `liveConverter.ingest`). Implementation may emit additional
    // closing entries on later inputs — the regression contract is just
    // "non-dbOnly entries do reach the timeline".
    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0].entry.type).toBe('assistant')
  })

  test('does not advance liveConverter state for dbOnly entries (no segment opened)', () => {
    // First, a real streaming chunk opens a buffer.
    appEvents.emit('log', {
      issueId: TEST_ISSUE_ID,
      executionId: 'exec-1',
      streaming: true,
      entry: {
        entryType: 'assistant-message',
        content: 'streamed',
        timestamp: '2026-05-10T00:00:00.000Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    })
    const segmentsAfterStream = captured.filter(c => c.entry.type === 'assistant').length

    // Then a dbOnly entry arrives — pre-fix, this would have closed the
    // streaming buffer and opened `turn-0-assistant-0001`, producing extra
    // emissions. With the fix, the stage early-returns and no new
    // timeline-entry surfaces.
    captured.length = 0
    appEvents.emit('log', {
      issueId: TEST_ISSUE_ID,
      executionId: 'exec-1',
      streaming: false,
      entry: {
        entryType: 'assistant-message',
        content: 'streamed (merged final from flushAssistantMessage)',
        timestamp: '2026-05-10T00:00:00.100Z',
        turnIndex: 0,
        metadata: { dbOnly: true },
      },
    })

    expect(captured).toHaveLength(0)
    // Sanity: the prior streaming open did register at least one segment.
    expect(segmentsAfterStream).toBeGreaterThan(0)
  })
})

/**
 * Regression: streaming chunks must not be trimmed before reaching the event
 * pipeline.
 *
 * Bug history (0.0.147): `handleStreamEntry` ran `entry.content.trim()` on
 * every chunk, including delta-style streams from codex / acp. The downstream
 * `mergeChunk` in timeline-converter concatenates chunks via `+=`, so any
 * leading / trailing whitespace stripped from a delta is gone forever — the
 * paragraph break between two markdown blocks (`...合理。\n\n` + `\n**真问题:**...`)
 * collapsed into `...合理。**真问题:**...` and broke rendering.
 *
 * Fix: only trim when `streaming === false` (final / cumulative entries).
 * Streaming deltas pass through verbatim so chunk boundary whitespace
 * survives concatenation.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { NormalizedLogEntry } from '@bkd/shared'
import { handleStderrEntry, handleStreamEntry } from '@/engines/issue/streams/handlers'
import { TimelineConverter } from '@/engines/timeline-converter'
import { appEvents } from '@/events'

const ISSUE_ID = 'iss_trim_test'
const EXEC_ID = 'exec_trim_test'

interface Captured {
  entry: NormalizedLogEntry
  streaming: boolean
}

let captured: Captured[]
let unsubscribe: () => void

beforeEach(() => {
  captured = []
  unsubscribe = appEvents.on('log', (data) => {
    if (data.issueId !== ISSUE_ID) return
    captured.push({ entry: data.entry, streaming: data.streaming })
  })
})

afterEach(() => {
  unsubscribe()
})

function deltaEntry(content: string): NormalizedLogEntry {
  return {
    entryType: 'assistant-message',
    content,
    turnIndex: 0,
    timestamp: new Date().toISOString(),
    metadata: { streaming: true },
  }
}

function finalEntry(content: string): NormalizedLogEntry {
  return {
    entryType: 'assistant-message',
    content,
    turnIndex: 0,
    timestamp: new Date().toISOString(),
    metadata: { streaming: false },
  }
}

describe('handleStreamEntry — chunk whitespace preservation', () => {
  test('streaming delta passes through verbatim (leading + trailing whitespace preserved)', () => {
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('合理。\n\n'))
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('\n**真问题:** sisyphus'))

    expect(captured).toHaveLength(2)
    expect(captured[0]!.entry.content).toBe('合理。\n\n')
    expect(captured[1]!.entry.content).toBe('\n**真问题:** sisyphus')
    expect(captured[0]!.streaming).toBe(true)
    expect(captured[1]!.streaming).toBe(true)
  })

  test('streaming delta keeps a leading \\n that opens a markdown list', () => {
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('paragraph end.'))
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('\n- item one\n- item two'))

    expect(captured[1]!.entry.content.startsWith('\n- ')).toBe(true)
  })

  test('streaming delta containing only whitespace is preserved (carries the paragraph break)', () => {
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('foo'))
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('\n\n'))
    handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry('bar'))

    expect(captured.map(c => c.entry.content)).toEqual(['foo', '\n\n', 'bar'])
  })

  test('non-streaming final entry IS still trimmed (legacy contract)', () => {
    handleStreamEntry(ISSUE_ID, EXEC_ID, finalEntry('  the final answer.\n\n'))

    expect(captured).toHaveLength(1)
    expect(captured[0]!.entry.content).toBe('the final answer.')
    expect(captured[0]!.streaming).toBe(false)
  })

  test('entry without streaming metadata is treated as non-streaming and trimmed', () => {
    const entry: NormalizedLogEntry = {
      entryType: 'system-message',
      content: '\n  notice  \n',
      turnIndex: 0,
      timestamp: new Date().toISOString(),
    }
    handleStreamEntry(ISSUE_ID, EXEC_ID, entry)

    expect(captured[0]!.entry.content).toBe('notice')
  })

  test('handleStderrEntry continues to trim (always non-streaming)', () => {
    handleStderrEntry(ISSUE_ID, EXEC_ID, {
      entryType: 'error-message',
      content: '\n  oops  \n',
      turnIndex: 0,
      timestamp: new Date().toISOString(),
    })

    expect(captured[0]!.entry.content).toBe('oops')
    expect(captured[0]!.streaming).toBe(false)
  })

  test('does not mutate the caller-owned entry object', () => {
    const original = deltaEntry('keep \n me')
    const snapshot = original.content
    handleStreamEntry(ISSUE_ID, EXEC_ID, original)
    expect(original.content).toBe(snapshot)
  })
})

describe('end-to-end: handler → TimelineConverter preserves markdown structure', () => {
  test('codex-style deltas with boundary newlines survive merge into renderable markdown', () => {
    // Simulate the exact failure mode from 0.0.147: assistant text split
    // across delta chunks at paragraph / list boundaries.
    const chunks = [
      '真答案: sisyphus runner_gc 不主动清孤儿。',
      '\n\n',
      '**真问题:** sisyphus runner_gc 不清 escalated REQ 的孤儿 pod',
      '\n\n',
      '- 今天 9 轮 smoke：留下 ~6–9 个孤儿\n',
      '- 每个 ~250m × 9 = 2250m\n',
    ]

    for (const c of chunks) {
      handleStreamEntry(ISSUE_ID, EXEC_ID, deltaEntry(c))
    }

    // All chunks captured untouched.
    expect(captured.map(c => c.entry.content)).toEqual(chunks)

    // Feeding the captured deltas through the real TimelineConverter must
    // produce content that markdown-renders as: heading paragraph, followed
    // by a bold paragraph, followed by a list — i.e. real `\n\n` separators
    // and a `\n- ` list bullet.
    const converter = new TimelineConverter()
    let final: string = ''
    for (const c of captured) {
      const out = converter.ingest(ISSUE_ID, c.entry)
      const last = out.at(-1)
      if (last) final = last.content
    }

    expect(final).toBe(chunks.join(''))
    expect(final).toContain('。\n\n**真问题:**') // paragraph break preserved
    expect(final).toContain('pod\n\n- 今天') // list opens on its own line
  })

  test('regression: pre-fix trimming would have collapsed paragraph + list — guard against it', () => {
    // Reproduce the broken behaviour explicitly so anyone reintroducing the
    // bug sees this assertion fail.
    const broken = ['paragraph end.\n\n', '\n- item'].map(s => s.trim()).join('')
    expect(broken).toBe('paragraph end.- item') // <- what users saw before the fix

    const fixed = ['paragraph end.\n\n', '\n- item'].join('')
    expect(fixed).toBe('paragraph end.\n\n\n- item') // <- correct: blank line + list bullet
  })
})

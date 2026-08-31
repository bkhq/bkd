import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ClaudeLogNormalizer } from '@/engines/executors/claude'
import {
  isTurnCompletionEntry,
  isTurnRestartEntry,
  readBackgroundTaskIds,
} from '@/engines/issue/streams/classification'
import type { NormalizedLogEntry } from '@/engines/types'
import './setup'

/**
 * Background-task turn settlement (ENG-036).
 *
 * The fixture is the decision-relevant subset of a real
 * `claude -p --output-format=stream-json --verbose --input-format stream-json
 * --forward-subagent-text` run (CLI 2.1.251) that dispatched one background
 * subagent and ended its turn without waiting. The CLI answers one prompt with
 * two turns: it reports the first complete while the task is still live, then
 * re-inits and runs another once the task reports back.
 */

interface Decision {
  liveTasks: number
  completedTurns: number
}

function replayFixture(): { completions: Decision[], restarts: Decision[] } {
  const normalizer = new ClaudeLogNormalizer()
  const raw = readFileSync(
    join(import.meta.dir, 'fixtures/claude-background-tasks.jsonl'),
    'utf8',
  )

  const liveTasks = new Set<string>()
  const completions: Decision[] = []
  const restarts: Decision[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parsed = normalizer.parse(line)
    if (!parsed) continue
    const entries: NormalizedLogEntry[] = Array.isArray(parsed) ? parsed : [parsed]

    for (const entry of entries) {
      const ids = readBackgroundTaskIds(entry)
      if (ids) {
        liveTasks.clear()
        for (const id of ids) liveTasks.add(id)
      }
      const snapshot = { liveTasks: liveTasks.size, completedTurns: completions.length }
      if (isTurnRestartEntry(entry)) restarts.push(snapshot)
      if (isTurnCompletionEntry(entry)) completions.push(snapshot)
    }
  }

  return { completions, restarts }
}

describe('claude background task turn settlement', () => {
  test('the first turn completes while the background task is still live', () => {
    const { completions } = replayFixture()

    expect(completions).toHaveLength(2)
    // Settling here is what drops the issue into 'review' mid-run — the hold
    // in handleTurnCompleted keys on exactly this count.
    expect(completions[0]!.liveTasks).toBe(1)
    // The CLI's follow-up turn ends with the task set drained: the real settle.
    expect(completions[1]!.liveTasks).toBe(0)
  })

  test('the follow-up turn re-inits after the first completion', () => {
    const { restarts } = replayFixture()

    expect(restarts).toHaveLength(2)
    expect(restarts[0]!.completedTurns).toBe(0)
    // Mid-stream restart: arrives after a turn we would already have settled.
    expect(restarts[1]!.completedTurns).toBe(1)
  })
})

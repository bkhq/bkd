import type { CockpitTimelineDelta, CockpitTimelineMessage } from '@bkd/shared'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildEnrichedReplyCard,
  enrichReplyCard,
  parseEnrichment,
} from '@/cockpit/secretary'
import type { ReplyCardRefs } from '@/cockpit/secretary'
import {
  appendOrReplace,
  applyEnrichment,
  recordEnrichmentError,
  subscribeTimeline,
} from '@/cockpit/timeline'
import { db } from '@/db'
import { cockpitTimelineMessages } from '@/db/schema'
import { createTestProject, expectSuccess, get, post } from './helpers'
import './setup'

let projectId: string
let issueId: string

beforeAll(async () => {
  projectId = await createTestProject('Secretary Test Project')
  const created = await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
    title: 'Target',
    statusId: 'todo',
  })
  issueId = expectSuccess(created).id
})

beforeEach(async () => {
  await db.delete(cockpitTimelineMessages)
})

const VALID_JSON = JSON.stringify({
  situation: 'The agent needs to know how to store order status.',
  recommendation: { candidateIndex: 1, reasoning: 'Enum is simpler for 4 states.' },
  candidates: [
    { label: 'New status table', text: 'Create a dedicated order_status table.' },
    { label: 'Use an enum', text: 'Keep it as an enum on the orders table.' },
  ],
})

function fakeRefs(): ReplyCardRefs {
  return { issueId, projectAlias: 'sec', issueNumber: 7 }
}

function fakeReplyCard(): CockpitTimelineMessage {
  return {
    id: 'msg-1',
    kind: 'suggest_reply',
    projectId,
    projectAlias: 'sec',
    issueId,
    issueNumber: 7,
    issueTitle: 'Add order status',
    body: 'is waiting on your reply.',
    actions: [],
    signalKey: `reply:${issueId}`,
    status: 'open',
    snoozedUntil: null,
    recommendation: null,
    enrichedAt: null,
    enrichmentStatus: 'template',
    enrichmentError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('parseEnrichment', () => {
  test('parses a clean JSON object', () => {
    const result = parseEnrichment(VALID_JSON)
    expect(result).not.toBeNull()
    expect(result!.situation).toContain('order status')
    expect(result!.candidates).toHaveLength(2)
    expect(result!.recommendationIndex).toBe(1)
    expect(result!.reasoning).toContain('Enum')
  })

  test('tolerates code fences and surrounding prose', () => {
    const wrapped = `Sure, here you go:\n\`\`\`json\n${VALID_JSON}\n\`\`\`\nDone.`
    const result = parseEnrichment(wrapped)
    expect(result).not.toBeNull()
    expect(result!.candidates).toHaveLength(2)
  })

  test('clamps an out-of-range recommendationIndex to 0', () => {
    const raw = JSON.stringify({
      situation: 'x',
      recommendation: { candidateIndex: 99, reasoning: 'r' },
      candidates: [{ label: 'a', text: 'aa' }],
    })
    expect(parseEnrichment(raw)!.recommendationIndex).toBe(0)
  })

  test('defaults recommendationIndex to 0 when missing', () => {
    const raw = JSON.stringify({
      situation: 'x',
      candidates: [{ label: 'a', text: 'aa' }, { label: 'b', text: 'bb' }],
    })
    expect(parseEnrichment(raw)!.recommendationIndex).toBe(0)
  })

  test('returns null when situation is missing', () => {
    const raw = JSON.stringify({ candidates: [{ label: 'a', text: 'aa' }] })
    expect(parseEnrichment(raw)).toBeNull()
  })

  test('returns null when there are no usable candidates', () => {
    const raw = JSON.stringify({ situation: 'x', candidates: [{ label: '', text: '' }] })
    expect(parseEnrichment(raw)).toBeNull()
  })

  test('returns null for non-JSON garbage', () => {
    expect(parseEnrichment('not json at all')).toBeNull()
    expect(parseEnrichment('')).toBeNull()
  })
})

describe('buildEnrichedReplyCard', () => {
  test('produces reply-preset actions plus an always-present escape hatch', () => {
    const enrichment = parseEnrichment(VALID_JSON)!
    const patch = buildEnrichedReplyCard(fakeRefs(), enrichment)

    const presets = patch.actions.filter(a => a.kind === 'reply-preset')
    expect(presets).toHaveLength(2)
    expect(presets[0]!.payload).toEqual({ issueId, text: 'Create a dedicated order_status table.' })

    // escape hatch + navigate + dismiss all present
    expect(patch.actions.some(a => a.kind === 'reply-input')).toBe(true)
    expect(patch.actions.some(a => a.kind === 'navigate')).toBe(true)
    expect(patch.actions.some(a => a.kind === 'dismiss')).toBe(true)
  })

  test('recommendation points at the recommended preset and tones it primary', () => {
    const enrichment = parseEnrichment(VALID_JSON)!
    const patch = buildEnrichedReplyCard(fakeRefs(), enrichment)

    expect(patch.recommendation.actionId).toBe('preset1')
    expect(patch.body).toContain('order status')
    const recommended = patch.actions.find(a => a.id === 'preset1')
    expect(recommended!.tone).toBe('primary')
    expect(patch.actions.find(a => a.id === 'preset0')!.tone).toBe('default')
  })

  test('omits the navigate action when project/issue refs are missing', () => {
    const enrichment = parseEnrichment(VALID_JSON)!
    const patch = buildEnrichedReplyCard(
      { issueId, projectAlias: null, issueNumber: null },
      enrichment,
    )
    expect(patch.actions.some(a => a.kind === 'navigate')).toBe(false)
  })
})

describe('enrichReplyCard — guard', () => {
  test('returns ok:false for non-suggest_reply cards without an AI call', async () => {
    const card = { ...fakeReplyCard(), kind: 'suggest_merge' as const }
    const res = await enrichReplyCard(card)
    expect(res.ok).toBe(false)
  })

  test('returns ok:false when the card has no issueId', async () => {
    const card = { ...fakeReplyCard(), issueId: null }
    const res = await enrichReplyCard(card)
    expect(res.ok).toBe(false)
  })
})

describe('secretary engine setting', () => {
  test('defaults to claude-code-sdk when unset', async () => {
    const res = await get<{ engineType: string }>('/api/cockpit/secretary-engine')
    expect(expectSuccess(res).engineType).toBe('claude-code-sdk')
  })

  test('POST changes the engine and GET reflects it', async () => {
    expectSuccess(await post('/api/cockpit/secretary-engine', { engineType: 'codex' }))
    const res = await get<{ engineType: string }>('/api/cockpit/secretary-engine')
    expect(expectSuccess(res).engineType).toBe('codex')
  })

  test('POST rejects an empty engineType', async () => {
    const res = await post('/api/cockpit/secretary-engine', { engineType: '' })
    expect(res.status).toBe(400)
  })
})

describe('secretary enabled toggle', () => {
  test('defaults to enabled and GET /secretary reports config', async () => {
    const res = await get<{ engineType: string, enabled: boolean }>('/api/cockpit/secretary')
    expect(expectSuccess(res).enabled).toBe(true)
  })

  test('POST toggles enrichment off and GET reflects it', async () => {
    expectSuccess(await post('/api/cockpit/secretary-enabled', { enabled: false }))
    const res = await get<{ enabled: boolean }>('/api/cockpit/secretary')
    expect(expectSuccess(res).enabled).toBe(false)
    // restore for other tests
    expectSuccess(await post('/api/cockpit/secretary-enabled', { enabled: true }))
  })
})

describe('secretary dry-run', () => {
  test('returns no_context for an issue with no logs', async () => {
    const res = await post<{
      reason: string | null
      raw: string | null
      parsed: unknown
    }>('/api/cockpit/secretary/dry-run', { issueId })
    const data = expectSuccess(res)
    expect(data.reason).toBe('no_context')
    expect(data.raw).toBeNull()
    expect(data.parsed).toBeNull()
  })

  test('rejects a missing issueId', async () => {
    const res = await post('/api/cockpit/secretary/dry-run', {})
    expect(res.status).toBe(400)
  })
})

describe('recordEnrichmentError', () => {
  test('records the failure reason on an open card and emits an update', async () => {
    const msg = await appendOrReplace({
      kind: 'suggest_reply',
      projectId,
      issueId,
      body: 'is waiting on your reply.',
      signalKey: `reply:${issueId}`,
      enrichmentStatus: 'structured',
    })

    const deltas: CockpitTimelineDelta[] = []
    const unsub = subscribeTimeline(d => deltas.push(d))
    const updated = await recordEnrichmentError(msg.id, 'timeout')
    unsub()

    expect(updated).not.toBeNull()
    expect(updated!.enrichmentError).toBe('timeout')
    // The rung is unchanged — only the failure reason is annotated.
    expect(updated!.enrichmentStatus).toBe('structured')
    expect(deltas).toHaveLength(1)
    expect(deltas[0]!.op).toBe('update')
  })

  test('returns null for a card that is no longer open', async () => {
    const msg = await appendOrReplace({
      kind: 'suggest_reply',
      projectId,
      issueId,
      body: 'older',
      signalKey: `reply:${issueId}`,
    })
    await appendOrReplace({
      kind: 'suggest_reply',
      projectId,
      issueId,
      body: 'newer',
      signalKey: `reply:${issueId}`,
    })
    expect(await recordEnrichmentError(msg.id, 'timeout')).toBeNull()
  })
})

describe('applyEnrichment — timeline patch', () => {
  test('patches an open card and emits an update delta', async () => {
    const msg = await appendOrReplace({
      kind: 'suggest_reply',
      projectId,
      issueId,
      body: 'is waiting on your reply.',
      actions: [{ id: 'reply', label: 'Reply', kind: 'reply-input' }],
      signalKey: `reply:${issueId}`,
      enrichmentStatus: 'template',
    })
    expect(msg.enrichmentStatus).toBe('template')

    const deltas: CockpitTimelineDelta[] = []
    const unsub = subscribeTimeline(d => deltas.push(d))
    const enrichment = parseEnrichment(VALID_JSON)!
    const patched = await applyEnrichment(msg.id, buildEnrichedReplyCard(fakeRefs(), enrichment))
    unsub()

    expect(patched).not.toBeNull()
    expect(patched!.recommendation?.actionId).toBe('preset1')
    expect(patched!.enrichedAt).not.toBeNull()
    expect(patched!.enrichmentStatus).toBe('enriched')
    expect(patched!.actions.filter(a => a.kind === 'reply-preset')).toHaveLength(2)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]!.op).toBe('update')
  })

  test('does not patch a card the user already acted on', async () => {
    const msg = await appendOrReplace({
      kind: 'suggest_reply',
      projectId,
      issueId,
      body: 'is waiting on your reply.',
      signalKey: `reply:${issueId}`,
    })
    // Supersede it (simulates the user/engine moving on).
    await appendOrReplace({
      kind: 'suggest_reply',
      projectId,
      issueId,
      body: 'newer',
      signalKey: `reply:${issueId}`,
    })

    const enrichment = parseEnrichment(VALID_JSON)!
    const patched = await applyEnrichment(
      msg.id,
      buildEnrichedReplyCard(fakeRefs(), enrichment),
    )
    expect(patched).toBeNull()
  })
})

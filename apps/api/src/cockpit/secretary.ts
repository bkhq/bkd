import type { CockpitTimelineAction, CockpitTimelineMessage, EngineType } from '@bkd/shared'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issueLogs, issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue/engine'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'
import { ensureCockpitProject, ensureSecretaryIssue } from '@/routes/cockpit/ensure-singleton'
import type { EnrichmentPatch } from './timeline'

/**
 * Cockpit secretary (PLAN-022 / COCKPIT-008).
 *
 * Turns a bare rule-based `suggest_reply` card into a decision card: a
 * one-line situation, 2-3 one-click candidate replies, and a recommended
 * choice with a rationale.
 *
 * The AI pass runs through the engine-agnostic issue pipeline: a single
 * hidden "secretary" issue is reused, its session reset per run, and the
 * enrichment prompt dispatched on whatever engine the user picked via the
 * `cockpit:secretaryEngine` setting. This means enrichment works with
 * Claude, Codex, or any other installed engine — it is not bound to one.
 *
 * Runs are serialized (one shared singleton issue) and every failure path
 * returns `null`, so the caller keeps the rule template card; enrichment
 * is strictly additive and never blocks the timeline.
 */

/** `appSettings` key holding the user-selected secretary engine. */
export const SECRETARY_ENGINE_KEY = 'cockpit:secretaryEngine'
/** `appSettings` key for the AI-enrichment master switch ('false' = off). */
export const SECRETARY_ENABLED_KEY = 'cockpit:secretaryEnabled'
const DEFAULT_ENGINE: EngineType = 'claude-code-sdk'
const ENRICH_TIMEOUT_MS = 120_000
const MAX_TURN_CHARS = 6000
const MAX_ENTRY_CHARS = 1500

/** Result of an enrichment attempt — drives the card's observable status. */
export type EnrichResult =
  | { ok: true, patch: EnrichmentPatch }
  | { ok: false, reason: EnrichFailureReason }

/** Why AI enrichment did not produce a card. Surfaced on the card UI. */
export type EnrichFailureReason
  = 'no_context' | 'timeout' | 'run_failed' | 'parse_failed'

/** References needed to build a reply decision card. */
export interface ReplyCardRefs {
  issueId: string
  projectAlias: string | null
  issueNumber: number | null
}

/** Parsed, validated secretary output. */
export interface SecretaryEnrichment {
  /** One sentence: what the agent needs the user to decide. */
  situation: string
  /** Index into `candidates` of the recommended reply. */
  recommendationIndex: number
  /** One short sentence: why that candidate is recommended. */
  reasoning: string
  /** 1-4 candidate replies. */
  candidates: Array<{ label: string, text: string }>
}

// ---------------------------------------------------------------------------
// Engine setting
// ---------------------------------------------------------------------------

/** The engine the secretary runs enrichment on. User-configurable. */
export async function getSecretaryEngine(): Promise<EngineType> {
  const stored = await getAppSetting(SECRETARY_ENGINE_KEY)
  return (stored && stored.trim() ? stored.trim() : DEFAULT_ENGINE) as EngineType
}

/** Whether AI enrichment is on. Off → cards stay at the structured/template rung. */
export async function isSecretaryEnabled(): Promise<boolean> {
  return (await getAppSetting(SECRETARY_ENABLED_KEY)) !== 'false'
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Enrich a freshly-appended `suggest_reply` card. Returns an `EnrichResult`:
 * `ok` carries the patch for `timeline.applyEnrichment`, otherwise `reason`
 * is recorded on the card via `timeline.recordEnrichmentError` so the UI can
 * explain why the card did not reach the `enriched` rung.
 */
export async function enrichReplyCard(
  msg: CockpitTimelineMessage,
): Promise<EnrichResult> {
  if (msg.kind !== 'suggest_reply' || !msg.issueId) {
    return { ok: false, reason: 'no_context' }
  }
  try {
    const context = await loadLastTurnContext(msg.issueId)
    if (!context) return { ok: false, reason: 'no_context' }
    const run = await serialize(() => runEnrichment(buildEnrichmentPrompt(
      msg.issueTitle,
      msg.issueNumber,
      context,
    )))
    if (!run.ok) return run
    const enrichment = parseEnrichment(run.text)
    if (!enrichment) return { ok: false, reason: 'parse_failed' }
    return {
      ok: true,
      patch: buildEnrichedReplyCard(
        { issueId: msg.issueId, projectAlias: msg.projectAlias, issueNumber: msg.issueNumber },
        enrichment,
      ),
    }
  } catch (err) {
    logger.warn({ err, issueId: msg.issueId }, 'cockpit_secretary_enrich_failed')
    return { ok: false, reason: 'run_failed' }
  }
}

/**
 * Run enrichment for one issue without touching the timeline — the
 * observability/test hook behind `POST /api/cockpit/secretary/dry-run`.
 * Returns the prompt context, the raw model output, and the parsed result
 * so the user can see exactly what the secretary produced.
 */
export async function dryRunEnrichment(issueId: string): Promise<{
  engine: EngineType
  context: string | null
  raw: string | null
  reason: EnrichFailureReason | null
  parsed: SecretaryEnrichment | null
}> {
  const engine = await getSecretaryEngine()
  const context = await loadLastTurnContext(issueId)
  if (!context) {
    return { engine, context: null, raw: null, reason: 'no_context', parsed: null }
  }
  const run = await serialize(() => runEnrichment(buildEnrichmentPrompt(null, null, context)))
  if (!run.ok) {
    return { engine, context, raw: null, reason: run.reason, parsed: null }
  }
  const parsed = parseEnrichment(run.text)
  return {
    engine,
    context,
    raw: run.text,
    reason: parsed ? null : 'parse_failed',
    parsed,
  }
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

/**
 * Concatenate the issue's last turn (assistant messages + tool calls) into a
 * bounded text blob the secretary can reason over. Returns `null` when there
 * is nothing useful to read.
 */
async function loadLastTurnContext(issueId: string): Promise<string | null> {
  const rows = await db
    .select({
      entryType: issueLogs.entryType,
      content: issueLogs.content,
      turnIndex: issueLogs.turnIndex,
    })
    .from(issueLogs)
    .where(and(eq(issueLogs.issueId, issueId), eq(issueLogs.visible, 1)))
    .orderBy(desc(issueLogs.turnIndex), desc(issueLogs.entryIndex))
    .limit(40)

  if (rows.length === 0) return null
  const lastTurnIdx = rows[0]!.turnIndex
  // rows are newest-first; reverse the last turn back to chronological order.
  const lastTurn = rows.filter(r => r.turnIndex === lastTurnIdx).reverse()

  const parts: string[] = []
  for (const r of lastTurn) {
    if (r.entryType !== 'assistant-message' && r.entryType !== 'tool-use') continue
    const text = r.content.slice(0, MAX_ENTRY_CHARS).trim()
    if (text) parts.push(`[${r.entryType}] ${text}`)
  }
  const joined = parts.join('\n\n').trim()
  return joined ? joined.slice(0, MAX_TURN_CHARS) : null
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildEnrichmentPrompt(
  issueTitle: string | null,
  issueNumber: number | null,
  context: string,
): string {
  const title = issueTitle ?? `#${issueNumber ?? '?'}`
  return [
    'You are the cockpit secretary for BKD, a kanban for AI coding agents.',
    'An AI coding agent paused mid-task and is waiting for the user to decide',
    'something. Read the agent\'s last turn and turn it into a one-click',
    'decision card. Do not use any tools — just read and answer.',
    '',
    `## Issue\n${title}`,
    '',
    `## Agent's last turn\n${context}`,
    '',
    '## Output',
    'Reply with ONLY a JSON object — no prose, no code fences:',
    '{',
    '  "situation": "one sentence stating what the agent needs the user to decide",',
    '  "recommendation": { "candidateIndex": 0, "reasoning": "one short sentence why" },',
    '  "candidates": [',
    '    { "label": "short button text, max 6 words", "text": "the full reply to send back to the agent" }',
    '  ]',
    '}',
    'Provide 2-3 candidates covering the realistic choices. "candidateIndex" is',
    'the index of the candidate you recommend. Answer in the language the agent',
    'used.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Engine-agnostic enrichment run
// ---------------------------------------------------------------------------

/** Serialize runs — the secretary issue is a single shared singleton. */
let enrichmentChain: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = enrichmentChain.then(task, task)
  enrichmentChain = run.then(() => undefined, () => undefined)
  return run
}

type RunResult = { ok: true, text: string } | { ok: false, reason: EnrichFailureReason }

/**
 * Dispatch the enrichment prompt on the configured engine via the singleton
 * secretary issue, wait for it to settle, and return the model's text output.
 */
async function runEnrichment(prompt: string): Promise<RunResult> {
  try {
    const engine = await getSecretaryEngine()
    const project = await ensureCockpitProject()
    const { id: issueId } = await ensureSecretaryIssue(project.id)

    // Reset the session so every run is a clean first turn on the chosen
    // engine — context must not leak between enrichments.
    await db
      .update(issuesTable)
      .set({
        engineType: engine,
        externalSessionId: null,
        sessionStatus: null,
        updatedAt: new Date(),
      })
      .where(eq(issuesTable.id, issueId))

    const waiter = waitForDone(issueId, ENRICH_TIMEOUT_MS)
    try {
      await issueEngine.executeIssue(issueId, {
        engineType: engine,
        prompt,
        workingDir: ROOT_DIR,
        displayPrompt: 'cockpit secretary enrichment',
      })
    } catch (err) {
      waiter.cancel()
      throw err
    }

    const status = await waiter.promise
    if (status === 'timeout') {
      logger.warn({ issueId }, 'cockpit_secretary_run_timeout')
      return { ok: false, reason: 'timeout' }
    }
    if (status !== 'completed') {
      logger.warn({ issueId, status }, 'cockpit_secretary_run_unfinished')
      return { ok: false, reason: 'run_failed' }
    }
    const text = await readLastAssistantMessage(issueId)
    if (!text) return { ok: false, reason: 'run_failed' }
    return { ok: true, text }
  } catch (err) {
    logger.warn({ err }, 'cockpit_secretary_run_failed')
    return { ok: false, reason: 'run_failed' }
  }
}

/** Resolve once the issue emits a `done` event, or on timeout. */
function waitForDone(
  issueId: string,
  timeoutMs: number,
): { promise: Promise<string>, cancel: () => void } {
  let settled = false
  let unsub: () => void = () => {}
  let timer: ReturnType<typeof setTimeout>

  const promise = new Promise<string>((resolve) => {
    const finish = (status: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      resolve(status)
    }
    timer = setTimeout(finish, timeoutMs, 'timeout')
    unsub = appEvents.on('done', (d) => {
      if (d.issueId === issueId) finish(d.finalStatus)
    })
  })

  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
    },
  }
}

/** Concatenate the secretary issue's most recent assistant turn. */
async function readLastAssistantMessage(issueId: string): Promise<string | null> {
  const rows = await db
    .select({
      content: issueLogs.content,
      turnIndex: issueLogs.turnIndex,
    })
    .from(issueLogs)
    .where(and(
      eq(issueLogs.issueId, issueId),
      eq(issueLogs.entryType, 'assistant-message'),
      eq(issueLogs.visible, 1),
    ))
    .orderBy(desc(issueLogs.turnIndex), desc(issueLogs.entryIndex))
    .limit(20)
  if (rows.length === 0) return null
  const lastTurn = rows[0]!.turnIndex
  const text = rows
    .filter(r => r.turnIndex === lastTurn)
    .reverse()
    .map(r => r.content)
    .join('\n')
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Parsing (pure — unit-tested)
// ---------------------------------------------------------------------------

/**
 * Parse + validate the secretary's JSON output. Tolerates code fences and
 * surrounding prose. Returns `null` if the shape is unusable.
 */
export function parseEnrichment(raw: string): SecretaryEnrichment | null {
  const jsonStr = extractJsonObject(raw)
  if (!jsonStr) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  const situation = typeof obj.situation === 'string' ? obj.situation.trim() : ''
  if (!situation) return null

  const rawCandidates = Array.isArray(obj.candidates) ? obj.candidates : []
  const candidates: Array<{ label: string, text: string }> = []
  for (const c of rawCandidates) {
    if (!c || typeof c !== 'object') continue
    const cand = c as Record<string, unknown>
    const label = typeof cand.label === 'string' ? cand.label.trim() : ''
    const text = typeof cand.text === 'string' ? cand.text.trim() : ''
    if (label && text) candidates.push({ label, text })
    if (candidates.length >= 4) break
  }
  if (candidates.length === 0) return null

  const rec = obj.recommendation && typeof obj.recommendation === 'object'
    ? obj.recommendation as Record<string, unknown>
    : {}
  let recommendationIndex = typeof rec.candidateIndex === 'number'
    && Number.isInteger(rec.candidateIndex)
    ? rec.candidateIndex
    : 0
  if (recommendationIndex < 0 || recommendationIndex >= candidates.length) {
    recommendationIndex = 0
  }
  const reasoning = typeof rec.reasoning === 'string' ? rec.reasoning.trim() : ''

  return { situation, recommendationIndex, reasoning, candidates }
}

/** Extract the first balanced-ish JSON object substring from arbitrary text. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}

// ---------------------------------------------------------------------------
// Card building (pure — unit-tested)
// ---------------------------------------------------------------------------

/**
 * Turn validated enrichment into a timeline patch: candidate replies become
 * one-click `reply-preset` actions, the free-text escape hatch is always
 * kept, and the recommendation points at the suggested candidate.
 */
export function buildEnrichedReplyCard(
  refs: ReplyCardRefs,
  enrichment: SecretaryEnrichment,
): EnrichmentPatch {
  const { issueId } = refs

  const presetActions: CockpitTimelineAction[] = enrichment.candidates.map((c, i) => ({
    id: `preset${i}`,
    label: c.label,
    kind: 'reply-preset',
    tone: i === enrichment.recommendationIndex ? 'primary' : 'default',
    payload: { issueId, text: c.text },
  }))

  const actions: CockpitTimelineAction[] = [...presetActions]
  // Escape hatch — always present so the user can override the candidates.
  actions.push({
    id: 'reply',
    label: 'Reply…',
    kind: 'reply-input',
    payload: { issueId },
  })
  if (refs.projectAlias && refs.issueNumber != null) {
    actions.push({
      id: 'open',
      label: 'Open',
      kind: 'navigate',
      payload: { projectAlias: refs.projectAlias, issueNumber: refs.issueNumber },
    })
  }
  actions.push({ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' })

  const recommended = enrichment.candidates[enrichment.recommendationIndex]!
  return {
    body: enrichment.situation,
    actions,
    recommendation: {
      actionId: `preset${enrichment.recommendationIndex}`,
      reasoning: enrichment.reasoning || `Recommended: ${recommended.label}`,
    },
  }
}

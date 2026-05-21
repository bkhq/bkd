import type {
  ChangesSummary,
  CockpitTimelineAction,
} from '@bkd/shared'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  issueLogs,
  issuesLogsToolsCall,
  issues as issuesTable,
  projects as projectsTable,
} from '@/db/schema'
import { buildEnrichedReplyCard } from './secretary'
import type { SecretaryEnrichment } from './secretary'
import type { AppendInput } from './timeline'

const OFF_TRACK_FILE_THRESHOLD = 8
const ASK_USER_TOOL_NAMES = ['AskUserQuestion', 'askUserQuestion', 'ask_user']
const REPEAT_FAIL_THRESHOLD = 3
const REPEAT_FAIL_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Rolling per-issue failure ring. Failures older than the window are
 * lazily dropped on read. In-memory only — restart resets the counter,
 * which is acceptable because repeated-failure is a "noisy issue today"
 * signal, not a historical audit.
 */
const failuresByIssue = new Map<string, number[]>()

export function recordFailure(issueId: string, atMs: number = Date.now()): number {
  const list = failuresByIssue.get(issueId) ?? []
  const cutoff = atMs - REPEAT_FAIL_WINDOW_MS
  const trimmed = list.filter(t => t >= cutoff)
  trimmed.push(atMs)
  failuresByIssue.set(issueId, trimmed)
  return trimmed.length
}

export function clearFailures(issueId: string): void {
  failuresByIssue.delete(issueId)
}

function currentFailureCount(issueId: string): number {
  const list = failuresByIssue.get(issueId)
  if (!list) return 0
  const cutoff = Date.now() - REPEAT_FAIL_WINDOW_MS
  const trimmed = list.filter(t => t >= cutoff)
  if (trimmed.length !== list.length) failuresByIssue.set(issueId, trimmed)
  return trimmed.length
}

export interface ClassifierContext {
  /** The fact that triggered classification — drives which checks run. */
  trigger: 'review-transition' | 'changes-summary' | 'cold-start' | 'failure' | 'stale'
}

export interface ClassifierResult {
  message: AppendInput
}

interface IssueRow {
  id: string
  projectId: string
  issueNumber: number
  title: string
  statusId: string
  sessionStatus: string | null
}

interface LastTurnSignals {
  hasAssistantMessage: boolean
  hasAskUserQuestion: boolean
  hasFailedToolUse: boolean
}

async function loadIssue(issueId: string): Promise<{ issue: IssueRow, projectAlias: string } | null> {
  const [issue] = await db
    .select({
      id: issuesTable.id,
      projectId: issuesTable.projectId,
      issueNumber: issuesTable.issueNumber,
      title: issuesTable.title,
      statusId: issuesTable.statusId,
      sessionStatus: issuesTable.sessionStatus,
      isHidden: issuesTable.isHidden,
    })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, issueId), eq(issuesTable.isDeleted, 0)))
  if (!issue) return null
  // Hidden issues (cockpit assistant + secretary singletons) drive their
  // own engine runs; they must never produce timeline cards about themselves.
  if (issue.isHidden) return null

  const [project] = await db
    .select({ alias: projectsTable.alias })
    .from(projectsTable)
    .where(eq(projectsTable.id, issue.projectId))
  return { issue, projectAlias: project?.alias ?? '' }
}

async function lastTurnSignals(issueId: string): Promise<LastTurnSignals> {
  // Pull the most recent ~30 visible log entries; cheap, bounded, and
  // enough to cover the final turn for typical sessions.
  const rows = await db
    .select({
      entryType: issueLogs.entryType,
      content: issueLogs.content,
      metadata: issueLogs.metadata,
      turnIndex: issueLogs.turnIndex,
    })
    .from(issueLogs)
    .where(and(eq(issueLogs.issueId, issueId), eq(issueLogs.visible, 1)))
    .orderBy(desc(issueLogs.turnIndex), desc(issueLogs.entryIndex))
    .limit(30)

  if (rows.length === 0) {
    return { hasAssistantMessage: false, hasAskUserQuestion: false, hasFailedToolUse: false }
  }

  const lastTurnIdx = rows[0]!.turnIndex
  const lastTurn = rows.filter(r => r.turnIndex === lastTurnIdx)

  let hasAssistantMessage = false
  let hasAskUserQuestion = false
  let hasFailedToolUse = false

  for (const r of lastTurn) {
    if (r.entryType === 'assistant-message') hasAssistantMessage = true
    if (r.entryType === 'tool-use') {
      // Lightweight: check metadata for known ask-user tool names or
      // failure marker. Avoids per-tool parsing.
      const md = r.metadata ?? ''
      if (ASK_USER_TOOL_NAMES.some(name => md.includes(name))) {
        hasAskUserQuestion = true
      }
      if (md.includes('"error"') || md.includes('"failed"')) {
        hasFailedToolUse = true
      }
    }
  }
  return { hasAssistantMessage, hasAskUserQuestion, hasFailedToolUse }
}

function buildMergeMessage(
  issue: IssueRow,
  projectAlias: string,
  changes: ChangesSummary | null,
): AppendInput {
  const diffPart = changes && changes.fileCount > 0 ?
    ` · ${changes.fileCount} file${changes.fileCount === 1 ? '' : 's'} +${changes.additions}/-${changes.deletions}` :
    ''
  const aliasPart = projectAlias ? `${projectAlias}/` : ''
  const actions: CockpitTimelineAction[] = [
    {
      id: 'merge',
      label: 'Move to done',
      kind: 'proposal',
      tone: 'primary',
      payload: { type: 'merge_issue', params: { issueId: issue.id } },
    },
    {
      id: 'open',
      label: 'Open',
      kind: 'navigate',
      payload: { projectAlias, issueNumber: issue.issueNumber },
    },
    {
      id: 'snooze1h',
      label: 'Snooze 1h',
      kind: 'snooze',
      payload: { hours: 1 },
    },
    {
      id: 'dismiss',
      label: 'Dismiss',
      kind: 'dismiss',
    },
  ]
  return {
    kind: 'suggest_merge',
    projectId: issue.projectId,
    issueId: issue.id,
    body: `\`${aliasPart}#${issue.issueNumber}\` ${issue.title} looks ready to merge${diffPart}.`,
    actions,
    signalKey: `merge:${issue.id}`,
  }
}

function buildStaleMessage(
  issue: IssueRow,
  projectAlias: string,
  idleMinutes: number,
): AppendInput {
  const aliasPart = projectAlias ? `${projectAlias}/` : ''
  return {
    kind: 'alert_stale_working',
    projectId: issue.projectId,
    issueId: issue.id,
    body: `\`${aliasPart}#${issue.issueNumber}\` ${issue.title} has been running for ${idleMinutes}m with no activity. Engine may have detached.`,
    actions: [
      {
        id: 'cancel',
        label: 'Cancel run',
        kind: 'proposal',
        tone: 'danger',
        payload: { type: 'cancel_issue', params: { issueId: issue.id } },
      },
      {
        id: 'restart',
        label: 'Restart',
        kind: 'proposal',
        payload: { type: 'restart_issue', params: { issueId: issue.id } },
      },
      {
        id: 'open',
        label: 'Open',
        kind: 'navigate',
        payload: { projectAlias, issueNumber: issue.issueNumber },
      },
      {
        id: 'dismiss',
        label: 'Dismiss',
        kind: 'dismiss',
      },
    ],
    signalKey: `stale:${issue.id}`,
  }
}

interface AskUserQuestion {
  question: string
  options: Array<{ label: string, description?: string, recommended?: boolean }>
  recommendedIndex?: number
}

/**
 * Level 2 of the degradation chain — load the agent's own `AskUserQuestion`
 * tool call (question + structured options) straight from the persisted
 * tool-call row. No AI. Returns `null` when there is no usable question.
 */
async function loadAskUserQuestion(issueId: string): Promise<AskUserQuestion | null> {
  const [row] = await db
    .select({ raw: issuesLogsToolsCall.raw })
    .from(issuesLogsToolsCall)
    .where(and(
      eq(issuesLogsToolsCall.issueId, issueId),
      eq(issuesLogsToolsCall.kind, 'user-question'),
      eq(issuesLogsToolsCall.isDeleted, 0),
    ))
    .orderBy(desc(issuesLogsToolsCall.createdAt))
    .limit(1)
  if (!row?.raw) return null

  try {
    const parsed = JSON.parse(row.raw) as { toolAction?: unknown }
    const ta = parsed.toolAction as {
      kind?: string
      questions?: unknown
      recommendedIndex?: unknown
    } | undefined
    if (!ta || ta.kind !== 'user-question' || !Array.isArray(ta.questions)) return null
    const q0 = ta.questions[0] as { question?: unknown, options?: unknown } | undefined
    if (!q0 || typeof q0.question !== 'string' || !q0.question.trim()) return null

    const options: AskUserQuestion['options'] = []
    if (Array.isArray(q0.options)) {
      for (const o of q0.options) {
        if (!o || typeof o !== 'object') continue
        const opt = o as { label?: unknown, description?: unknown, recommended?: unknown }
        if (typeof opt.label !== 'string' || !opt.label.trim()) continue
        options.push({
          label: opt.label.trim(),
          description: typeof opt.description === 'string' ? opt.description : undefined,
          recommended: opt.recommended === true,
        })
      }
    }
    const recommendedIndex = typeof ta.recommendedIndex === 'number'
      && Number.isInteger(ta.recommendedIndex)
      ? ta.recommendedIndex
      : undefined
    return { question: q0.question.trim(), options, recommendedIndex }
  } catch {
    return null
  }
}

/** Map an `AskUserQuestion` onto the secretary enrichment shape (no AI). */
function askUserQuestionToEnrichment(auq: AskUserQuestion): SecretaryEnrichment {
  const candidates = auq.options.map(o => ({ label: o.label, text: o.label }))
  let recommendationIndex = auq.recommendedIndex ?? auq.options.findIndex(o => o.recommended)
  if (recommendationIndex == null || recommendationIndex < 0 || recommendationIndex >= candidates.length) {
    recommendationIndex = 0
  }
  return {
    situation: auq.question,
    recommendationIndex,
    reasoning: auq.options[recommendationIndex]?.description ?? '',
    candidates,
  }
}

/**
 * Build the `suggest_reply` card. Level 2 when the agent's `AskUserQuestion`
 * carried structured options (one-click buttons, no AI); level 3 (template)
 * otherwise. The AI secretary may later enrich either into level 1.
 */
async function buildReplyMessage(issue: IssueRow, projectAlias: string): Promise<AppendInput> {
  const auq = await loadAskUserQuestion(issue.id)
  if (auq && auq.options.length > 0) {
    const card = buildEnrichedReplyCard(
      { issueId: issue.id, projectAlias, issueNumber: issue.issueNumber },
      askUserQuestionToEnrichment(auq),
    )
    return {
      kind: 'suggest_reply',
      projectId: issue.projectId,
      issueId: issue.id,
      body: card.body,
      actions: card.actions,
      signalKey: `reply:${issue.id}`,
      enrichmentStatus: 'structured',
      recommendation: card.recommendation,
    }
  }

  // Level 3 — no structured options to surface; bare template card.
  const aliasPart = projectAlias ? `${projectAlias}/` : ''
  return {
    kind: 'suggest_reply',
    projectId: issue.projectId,
    issueId: issue.id,
    body: `\`${aliasPart}#${issue.issueNumber}\` ${issue.title} is waiting on your reply.`,
    actions: [
      {
        id: 'reply',
        label: 'Reply',
        kind: 'reply-input',
        tone: 'primary',
        payload: { issueId: issue.id },
      },
      {
        id: 'open',
        label: 'Open',
        kind: 'navigate',
        payload: { projectAlias, issueNumber: issue.issueNumber },
      },
      {
        id: 'dismiss',
        label: 'Dismiss',
        kind: 'dismiss',
      },
    ],
    signalKey: `reply:${issue.id}`,
    enrichmentStatus: 'template',
  }
}

function buildRepeatFailMessage(
  issue: IssueRow,
  projectAlias: string,
  failureCount: number,
): AppendInput {
  const aliasPart = projectAlias ? `${projectAlias}/` : ''
  return {
    kind: 'alert_repeat_fail',
    projectId: issue.projectId,
    issueId: issue.id,
    body: `\`${aliasPart}#${issue.issueNumber}\` ${issue.title} failed ${failureCount} times in the last 24h.`,
    actions: [
      {
        id: 'restart',
        label: 'Restart',
        kind: 'proposal',
        tone: 'primary',
        payload: { type: 'restart_issue', params: { issueId: issue.id } },
      },
      {
        id: 'open',
        label: 'Take a look',
        kind: 'navigate',
        payload: { projectAlias, issueNumber: issue.issueNumber },
      },
      {
        id: 'dismiss',
        label: 'Dismiss',
        kind: 'dismiss',
      },
    ],
    signalKey: `repeatfail:${issue.id}`,
  }
}

function buildOffTrackMessage(
  issue: IssueRow,
  projectAlias: string,
  changes: ChangesSummary,
): AppendInput {
  const aliasPart = projectAlias ? `${projectAlias}/` : ''
  const actions: CockpitTimelineAction[] = [
    {
      id: 'open',
      label: 'Take a look',
      kind: 'navigate',
      tone: 'primary',
      payload: { projectAlias, issueNumber: issue.issueNumber },
    },
    {
      id: 'cancel',
      label: 'Cancel run',
      kind: 'proposal',
      tone: 'danger',
      payload: { type: 'cancel_issue', params: { issueId: issue.id } },
    },
    {
      id: 'dismiss',
      label: 'Dismiss',
      kind: 'dismiss',
    },
  ]
  return {
    kind: 'alert_off_track',
    projectId: issue.projectId,
    issueId: issue.id,
    body: `\`${aliasPart}#${issue.issueNumber}\` touched ${changes.fileCount} files (+${changes.additions}/-${changes.deletions}) — wider than expected. Worth a look.`,
    actions,
    signalKey: `offtrack:${issue.id}`,
  }
}

/**
 * Classify a single issue. Returns the next timeline message to append, or
 * null if nothing should be posted right now.
 */
export async function classifyIssue(
  issueId: string,
  changes: ChangesSummary | null,
  ctx: ClassifierContext,
): Promise<ClassifierResult | null> {
  const loaded = await loadIssue(issueId)
  if (!loaded) return null
  const { issue, projectAlias } = loaded

  // Repeated failures bucket fires regardless of status — the issue is
  // misbehaving so it needs attention even if it never reached review.
  if (currentFailureCount(issueId) >= REPEAT_FAIL_THRESHOLD) {
    return { message: buildRepeatFailMessage(issue, projectAlias, currentFailureCount(issueId)) }
  }

  // Stale-in-working: dedicated trigger from the periodic stale checker.
  // The caller is responsible for not invoking us unless the issue truly
  // looks stuck; we just emit the message.
  if (ctx.trigger === 'stale') {
    if (issue.statusId !== 'working') return null
    const idleMinutes = await issueIdleMinutes(issueId)
    return { message: buildStaleMessage(issue, projectAlias, idleMinutes) }
  }

  // Failure-only trigger doesn't run the review-status pipeline below.
  if (ctx.trigger === 'failure') return null

  // Only `review`-status issues are candidates in M1.
  if (issue.statusId !== 'review') return null

  const signals = await lastTurnSignals(issueId)

  // Hazard first: off-track diff. Wide diff is a stronger signal than
  // the merge-ready criteria, so check it before suggesting merge.
  if (changes && changes.fileCount > OFF_TRACK_FILE_THRESHOLD) {
    return { message: buildOffTrackMessage(issue, projectAlias, changes) }
  }

  // Awaiting reply: only when an AskUserQuestion tool fired last turn.
  if (signals.hasAskUserQuestion) {
    return { message: await buildReplyMessage(issue, projectAlias) }
  }

  // Merge-ready: engine produced an assistant turn, no failing tool, no
  // pending user question, and a non-empty diff (or no diff yet — we
  // still suggest review so the user can flip status manually).
  if (signals.hasAssistantMessage && !signals.hasFailedToolUse) {
    return { message: buildMergeMessage(issue, projectAlias, changes) }
  }

  return null
}

/**
 * Minutes since the last visible log entry for a working issue. If there
 * are no logs at all, fall back to time since the issue's statusUpdatedAt.
 */
async function issueIdleMinutes(issueId: string): Promise<number> {
  const [last] = await db
    .select({ created: issueLogs.createdAt })
    .from(issueLogs)
    .where(and(eq(issueLogs.issueId, issueId), eq(issueLogs.visible, 1)))
    .orderBy(desc(issueLogs.createdAt))
    .limit(1)
  let anchorMs: number
  if (last?.created) {
    anchorMs = last.created instanceof Date ? last.created.getTime() : Number(last.created) * 1000
  } else {
    const [iss] = await db
      .select({ ts: issuesTable.statusUpdatedAt })
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))
    if (!iss) return 0
    anchorMs = iss.ts instanceof Date ? iss.ts.getTime() : Number(iss.ts) * 1000
  }
  return Math.max(0, Math.round((Date.now() - anchorMs) / 60_000))
}

export async function listStaleWorkingIssueIds(idleMinThreshold: number): Promise<string[]> {
  const rows = await db
    .select({ id: issuesTable.id, statusUpdatedAt: issuesTable.statusUpdatedAt })
    .from(issuesTable)
    .where(and(eq(issuesTable.statusId, 'working'), eq(issuesTable.isDeleted, 0)))
  const out: string[] = []
  for (const r of rows) {
    const idle = await issueIdleMinutes(r.id)
    if (idle >= idleMinThreshold) out.push(r.id)
  }
  return out
}

export async function listReviewIssueIds(): Promise<string[]> {
  const rows = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(and(eq(issuesTable.statusId, 'review'), eq(issuesTable.isDeleted, 0)))
  return rows.map(r => r.id)
}

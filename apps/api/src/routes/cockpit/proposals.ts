import { and, desc, eq, inArray, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { proposalStore } from '@/cockpit/proposals'
import type { CockpitProposalType } from '@/cockpit/proposals'
import { STATUS_IDS } from '@/config'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue/engine'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'

const proposals = createOpenAPIRouter()

// GET /api/cockpit/proposals — list pending
proposals.get('/', (c) => {
  const pending = proposalStore.listPending()
  return c.json({ success: true, data: pending })
})

// POST /api/cockpit/proposals/execute — create+approve a proposal in one shot.
// Used by always-on bot timeline action buttons where the user click IS the
// approval (no separate review step needed).
proposals.post('/execute', async (c) => {
  let body: { type?: string, params?: Record<string, unknown> }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400)
  }
  const type = body.type
  const params = body.params
  if (typeof type !== 'string') {
    return c.json({ success: false, error: 'type is required' }, 400)
  }
  if (!params || typeof params !== 'object') {
    return c.json({ success: false, error: 'params object is required' }, 400)
  }
  const allowed: ReadonlySet<CockpitProposalType> = new Set([
    'cancel_issue',
    'restart_issue',
    'bulk_update_status',
    'create_issue',
    'merge_issue',
    'bulk_merge',
    'send_reply',
  ])
  if (!allowed.has(type as CockpitProposalType)) {
    return c.json({ success: false, error: `Unsupported proposal type: ${type}` }, 400)
  }

  const proposal = proposalStore.propose(
    type as CockpitProposalType,
    params as never,
    `inline:${type}`,
  )
  try {
    const result = await dispatch(type as CockpitProposalType, params)
    proposalStore.markApproved(proposal.id, result)
    appEvents.emit('cockpit-proposal', { proposalId: proposal.id, status: 'approved' })
    return c.json({ success: true, data: { proposalId: proposal.id, status: 'approved', result } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dispatch failed'
    proposalStore.markFailed(proposal.id, message)
    appEvents.emit('cockpit-proposal', { proposalId: proposal.id, status: 'failed' })
    logger.warn({ type, err }, 'cockpit_inline_dispatch_failed')
    return c.json({ success: false, error: message }, 400)
  }
})

// POST /api/cockpit/proposals/:id/approve
proposals.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const p = proposalStore.get(id)
  if (!p) return c.json({ success: false, error: 'Proposal not found or expired' }, 404)
  if (p.status !== 'pending') {
    return c.json({ success: false, error: `Proposal already ${p.status}` }, 409)
  }

  try {
    const result = await dispatch(p.type, p.params)
    const updated = proposalStore.markApproved(id, result)
    appEvents.emit('cockpit-proposal', { proposalId: id, status: 'approved' })
    return c.json({ success: true, data: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dispatch failed'
    logger.warn({ id, type: p.type, err }, 'cockpit_proposal_dispatch_failed')
    proposalStore.markFailed(id, message)
    appEvents.emit('cockpit-proposal', { proposalId: id, status: 'failed' })
    return c.json({ success: false, error: message }, 400)
  }
})

// POST /api/cockpit/proposals/:id/reject
proposals.post('/:id/reject', (c) => {
  const id = c.req.param('id')
  const p = proposalStore.get(id)
  if (!p) return c.json({ success: false, error: 'Proposal not found or expired' }, 404)
  if (p.status !== 'pending') {
    return c.json({ success: false, error: `Proposal already ${p.status}` }, 409)
  }
  const updated = proposalStore.markRejected(id)
  appEvents.emit('cockpit-proposal', { proposalId: id, status: 'rejected' })
  return c.json({ success: true, data: updated })
})

// ---------- internal dispatchers ----------

async function dispatch(
  type: CockpitProposalType,
  rawParams: unknown,
): Promise<unknown> {
  switch (type) {
    case 'cancel_issue':
      return dispatchCancel(rawParams as { issueId: string })
    case 'restart_issue':
      return dispatchRestart(rawParams as { issueId: string })
    case 'bulk_update_status':
      return dispatchBulkUpdate(rawParams as { issueIds: string[], statusId: string })
    case 'create_issue':
      return dispatchCreate(rawParams as { projectId: string, title: string, statusId?: string })
    case 'merge_issue':
      return dispatchMerge(rawParams as { issueId: string })
    case 'bulk_merge':
      return dispatchBulkMerge(rawParams as { issueIds: string[] })
    case 'send_reply':
      return dispatchSendReply(rawParams as { issueId: string, body: string })
  }
}

async function ensureIssueExists(issueId: string): Promise<void> {
  const [row] = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, issueId), eq(issuesTable.isDeleted, 0)))
  if (!row) throw new Error(`Issue not found: ${issueId}`)
}

async function dispatchBulkMerge(p: { issueIds: string[] }) {
  if (!Array.isArray(p.issueIds) || p.issueIds.length === 0) {
    throw new Error('issueIds is required and must be non-empty')
  }
  if (p.issueIds.length > 5) {
    throw new Error('bulk_merge capped at 5 issues per proposal')
  }
  const rows = await db
    .select({ id: issuesTable.id, statusId: issuesTable.statusId })
    .from(issuesTable)
    .where(and(inArray(issuesTable.id, p.issueIds), eq(issuesTable.isDeleted, 0)))
  const found = new Set(rows.map(r => r.id))
  const missing = p.issueIds.filter(id => !found.has(id))
  if (missing.length > 0) throw new Error(`Issues not found: ${missing.join(', ')}`)
  const notReview = rows.filter(r => r.statusId !== 'review').map(r => r.id)
  if (notReview.length > 0) {
    throw new Error(`bulk_merge requires all issues in review (offenders: ${notReview.join(', ')})`)
  }

  await db
    .update(issuesTable)
    .set({ statusId: 'done', statusUpdatedAt: new Date(), updatedAt: new Date() })
    .where(inArray(issuesTable.id, p.issueIds))
  return { mergedIds: p.issueIds, statusId: 'done' }
}

async function dispatchSendReply(p: { issueId: string, body: string }) {
  if (typeof p.body !== 'string' || p.body.trim().length === 0) {
    throw new Error('body is required and must be non-empty')
  }
  if (p.body.length > 8000) {
    throw new Error('body is too long (max 8000 chars)')
  }
  await ensureIssueExists(p.issueId)
  const result = await issueEngine.followUpIssue(
    p.issueId,
    p.body,
    undefined,
    undefined,
    'queue',
    p.body.slice(0, 200),
  )
  return { issueId: p.issueId, executionId: result.executionId, messageId: result.messageId ?? null }
}

async function dispatchMerge(p: { issueId: string }) {
  await ensureIssueExists(p.issueId)
  // Status-only flip. No git ops — the user owns commit/push. Reject if
  // the issue is not currently in review to avoid surprise transitions
  // (e.g. user moved it back to working manually).
  const [row] = await db
    .select({ statusId: issuesTable.statusId })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, p.issueId), eq(issuesTable.isDeleted, 0)))
  if (!row) throw new Error(`Issue not found: ${p.issueId}`)
  if (row.statusId !== 'review') {
    throw new Error(`merge_issue requires review status (current: ${row.statusId})`)
  }
  await db
    .update(issuesTable)
    .set({ statusId: 'done', statusUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(issuesTable.id, p.issueId))
  return { issueId: p.issueId, statusId: 'done' }
}

async function dispatchCancel(p: { issueId: string }) {
  await ensureIssueExists(p.issueId)
  const status = await issueEngine.cancelIssue(p.issueId)
  return { issueId: p.issueId, status }
}

async function dispatchRestart(p: { issueId: string }) {
  await ensureIssueExists(p.issueId)
  const { executionId } = await issueEngine.restartIssue(p.issueId)
  return { issueId: p.issueId, executionId }
}

async function dispatchBulkUpdate(p: { issueIds: string[], statusId: string }) {
  if (!Array.isArray(p.issueIds) || p.issueIds.length === 0) {
    throw new Error('issueIds is required and must be non-empty')
  }
  if (p.issueIds.length > 50) {
    throw new Error('bulk_update_status capped at 50 issues per proposal')
  }
  if (!(STATUS_IDS as readonly string[]).includes(p.statusId)) {
    throw new Error(`Invalid statusId: ${p.statusId}`)
  }

  const rows = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(and(inArray(issuesTable.id, p.issueIds), eq(issuesTable.isDeleted, 0)))
  const foundIds = new Set(rows.map(r => r.id))
  const missing = p.issueIds.filter(id => !foundIds.has(id))
  if (missing.length > 0) {
    throw new Error(`Issues not found: ${missing.join(', ')}`)
  }

  await db
    .update(issuesTable)
    .set({ statusId: p.statusId, statusUpdatedAt: new Date(), updatedAt: new Date() })
    .where(inArray(issuesTable.id, p.issueIds))

  return { updatedIds: p.issueIds, statusId: p.statusId }
}

async function dispatchCreate(p: { projectId: string, title: string, statusId?: string }) {
  if (!p.title || typeof p.title !== 'string' || p.title.length === 0) {
    throw new Error('title is required')
  }
  const statusId = p.statusId ?? 'todo'
  if (!(STATUS_IDS as readonly string[]).includes(statusId)) {
    throw new Error(`Invalid statusId: ${statusId}`)
  }

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, p.projectId), eq(projectsTable.isDeleted, 0)))
  if (!project) throw new Error(`Project not found: ${p.projectId}`)

  const [maxNumRow] = await db
    .select({ maxNum: max(issuesTable.issueNumber) })
    .from(issuesTable)
    .where(eq(issuesTable.projectId, project.id))
  const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

  const [lastItem] = await db
    .select({ sortOrder: issuesTable.sortOrder })
    .from(issuesTable)
    .where(and(
      eq(issuesTable.projectId, project.id),
      eq(issuesTable.statusId, statusId),
      eq(issuesTable.isDeleted, 0),
    ))
    .orderBy(desc(issuesTable.sortOrder))
    .limit(1)
  const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

  const [created] = await db
    .insert(issuesTable)
    .values({
      projectId: project.id,
      statusId,
      issueNumber,
      title: p.title,
      sortOrder,
      prompt: p.title,
    })
    .returning({ id: issuesTable.id, title: issuesTable.title, statusId: issuesTable.statusId })

  return created
}

export default proposals

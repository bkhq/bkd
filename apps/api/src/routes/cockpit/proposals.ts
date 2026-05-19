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
  }
}

async function ensureIssueExists(issueId: string): Promise<void> {
  const [row] = await db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, issueId), eq(issuesTable.isDeleted, 0)))
  if (!row) throw new Error(`Issue not found: ${issueId}`)
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

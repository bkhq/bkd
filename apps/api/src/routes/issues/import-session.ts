import { and, desc, eq, isNotNull, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { ulid } from 'ulid'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'
import { persistLogEntry } from '@/engines/issue/persistence/log-entry'
import { persistToolDetail } from '@/engines/issue/persistence/tool-detail'
import type { NormalizedLogEntry } from '@/engines/types'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { findLocalSession, readLocalSession } from '@/sessions'
import { serializeIssue } from './_shared'

const importSession = createOpenAPIRouter()

/** Cap on backfilled entries — the newest turns are the ones worth keeping. */
const MAX_IMPORTED_ENTRIES = 2000

function nextIssueNumber(projectId: string): number {
  const [row] = db
    .select({ maxNum: max(issuesTable.issueNumber) })
    .from(issuesTable)
    .where(eq(issuesTable.projectId, projectId))
    .all()
  return (row?.maxNum ?? 0) + 1
}

function nextSortOrder(projectId: string, statusId: string): string {
  const [last] = db
    .select({ sortOrder: issuesTable.sortOrder })
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.projectId, projectId),
        eq(issuesTable.statusId, statusId),
        eq(issuesTable.isDeleted, 0),
      ),
    )
    .orderBy(desc(issuesTable.sortOrder))
    .limit(1)
    .all()
  return generateKeyBetween(last?.sortOrder ?? null, null)
}

/**
 * Write imported entries through the same persistence primitives the live
 * pipeline uses, so tool calls keep their detail rows and render normally.
 */
function backfillLogs(issueId: string, entries: NormalizedLogEntry[]): number {
  const executionId = ulid()
  let turnIndex = 0
  let written = 0

  for (const [index, entry] of entries.entries()) {
    if (entry.entryType === 'user-message') turnIndex++

    const isToolUse = entry.entryType === 'tool-use'
    // Tool metadata lives in the tools table only — same split as the live path.
    const dbEntry = isToolUse ? { ...entry, metadata: undefined } : entry
    const persisted = persistLogEntry(issueId, executionId, dbEntry, index, turnIndex, null)
    if (!persisted?.messageId) continue
    written++

    if (isToolUse) {
      db.transaction((tx) => {
        const toolRecordId = persistToolDetail(persisted.messageId!, issueId, entry)
        if (toolRecordId) {
          tx.update(logsTable)
            .set({ toolCallRefId: toolRecordId })
            .where(eq(logsTable.id, persisted.messageId!))
            .run()
        }
      })
    }
  }

  return written
}

// POST /api/projects/:projectId/issues/import-session
importSession.openapi(R.importSession, async (c) => {
  const { projectId } = c.req.valid('param')
  const body = c.req.valid('json')

  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false as const, error: 'Project not found' }, 404)
  }

  const record = await findLocalSession(body.engine, body.sessionId)
  if (!record) {
    return c.json({ success: false as const, error: 'Session not found' }, 404)
  }

  const [existing] = db
    .select({ id: issuesTable.id })
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.isDeleted, 0),
        isNotNull(issuesTable.externalSessionId),
        eq(issuesTable.externalSessionId, record.sessionId),
      ),
    )
    .limit(1)
    .all()
  if (existing) {
    return c.json(
      { success: false as const, error: `Session already imported as issue ${existing.id}` },
      409,
    )
  }

  // A session recorded under a different directory will not resume into this
  // project. The caller decides whether that is acceptable; it is reported back.
  const cwdMatches = !!record.cwd && !!project.directory && record.cwd === project.directory

  const statusId = body.statusId ?? 'review'
  const title = body.title ?? record.title ?? `Imported ${record.engine} session`

  const [issue] = db
    .insert(issuesTable)
    .values({
      projectId: project.id,
      statusId,
      issueNumber: nextIssueNumber(project.id),
      title,
      sortOrder: nextSortOrder(project.id, statusId),
      engineType: record.engine,
      model: record.model ?? null,
      sessionStatus: 'completed',
      prompt: record.title || title,
      externalSessionId: record.sessionId,
    })
    .returning()
    .all()

  if (!issue) {
    return c.json({ success: false as const, error: 'Failed to create issue' }, 404)
  }

  let importedEntries = 0
  let droppedEntries = 0
  if (body.importLogs !== false) {
    const entries = await readLocalSession(record)
    const kept = entries.length > MAX_IMPORTED_ENTRIES ? entries.slice(-MAX_IMPORTED_ENTRIES) : entries
    droppedEntries = entries.length - kept.length
    importedEntries = backfillLogs(issue.id, kept)
  }

  await cacheDel(`projectIssueIds:${project.id}`)
  logger.info(
    {
      issueId: issue.id,
      engine: record.engine,
      sessionId: record.sessionId,
      importedEntries,
      droppedEntries,
      cwdMatches,
    },
    'session_imported',
  )

  return c.json(
    {
      success: true as const,
      data: { issue: serializeIssue(issue), importedEntries, droppedEntries, cwdMatches },
    },
    201,
  )
})

export default importSession

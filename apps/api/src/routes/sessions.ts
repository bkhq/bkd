import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { deleteLocalSession, findLocalSession, listLocalSessions, readLocalSession } from '@/sessions'
import type { LocalSession, LocalSessionRecord } from '@/sessions'
import { logger } from '@/logger'

const sessionsRoute = createOpenAPIRouter()

const DEFAULT_LIMIT = 50
const DEFAULT_PREVIEW_ENTRIES = 200

/** Session as returned by the API — the on-disk path stays server-side. */
type SessionSummary = LocalSession & {
  managedByIssueId?: string
  managedByProjectId?: string
  matchedProjectId?: string
}

/**
 * BKD writes its own sessions into the same directories, so every row is
 * annotated with the issue that owns it (when any) and with the project whose
 * directory matches the session cwd.
 */
function annotate(records: LocalSessionRecord[]): SessionSummary[] {
  const owners = new Map<string, { issueId: string, projectId: string }>()
  const rows = db
    .select({
      id: issuesTable.id,
      projectId: issuesTable.projectId,
      externalSessionId: issuesTable.externalSessionId,
    })
    .from(issuesTable)
    .where(and(eq(issuesTable.isDeleted, 0), isNotNull(issuesTable.externalSessionId)))
    .all()
  for (const row of rows) {
    if (row.externalSessionId) owners.set(row.externalSessionId, { issueId: row.id, projectId: row.projectId })
  }

  const projectByDir = new Map<string, string>()
  const projectRows = db
    .select({ id: projectsTable.id, directory: projectsTable.directory })
    .from(projectsTable)
    .where(eq(projectsTable.isDeleted, 0))
    .all()
  for (const row of projectRows) {
    if (row.directory) projectByDir.set(row.directory, row.id)
  }

  return records.map(({ path: _path, ...session }) => {
    const owner = owners.get(session.sessionId)
    const matchedProjectId = session.cwd ? projectByDir.get(session.cwd) : undefined
    return {
      ...session,
      ...(owner ? { managedByIssueId: owner.issueId, managedByProjectId: owner.projectId } : {}),
      ...(matchedProjectId ? { matchedProjectId } : {}),
    }
  })
}

sessionsRoute.openapi(R.listLocalSessions, async (c) => {
  const { engine, search, managed, limit, offset } = c.req.valid('query')

  let sessions = annotate(await listLocalSessions())

  if (engine) sessions = sessions.filter(s => s.engine === engine)
  if (managed) {
    const wantManaged = managed === 'true'
    sessions = sessions.filter(s => !!s.managedByIssueId === wantManaged)
  }
  if (search) {
    const needle = search.toLowerCase()
    sessions = sessions.filter(
      s => s.title.toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle),
    )
  }

  const start = offset ?? 0
  const size = limit ?? DEFAULT_LIMIT
  const page = sessions.slice(start, start + size)

  return c.json({
    success: true as const,
    data: { sessions: page, total: sessions.length, hasMore: start + size < sessions.length },
  })
})

sessionsRoute.openapi(R.getLocalSession, async (c) => {
  const { engine, sessionId } = c.req.valid('param')
  const { limit } = c.req.valid('query')

  const record = await findLocalSession(engine, sessionId)
  if (!record) {
    return c.json({ success: false as const, error: 'Session not found' }, 404)
  }

  const entries = await readLocalSession(record)
  const size = limit ?? DEFAULT_PREVIEW_ENTRIES
  // Preview shows the tail — the end of a session is what identifies it.
  const page = entries.length > size ? entries.slice(-size) : entries

  return c.json({
    success: true as const,
    data: {
      session: annotate([record])[0]!,
      entries: page,
      totalEntries: entries.length,
    },
  }, 200)
})

/** Session ids currently claimed by a live issue — deleting those breaks follow-up. */
function claimedSessionIds(): Set<string> {
  const rows = db
    .select({ externalSessionId: issuesTable.externalSessionId })
    .from(issuesTable)
    .where(and(eq(issuesTable.isDeleted, 0), isNotNull(issuesTable.externalSessionId)))
    .all()
  return new Set(rows.map(r => r.externalSessionId).filter((id): id is string => !!id))
}

sessionsRoute.openapi(R.deleteLocalSessions, async (c) => {
  const { sessions } = c.req.valid('json')
  const claimed = claimedSessionIds()

  const deleted: string[] = []
  const failed: Array<{ sessionId: string, error: string }> = []

  for (const { engine, sessionId } of sessions) {
    // A soft-deleted issue no longer claims its session, which is exactly the
    // case this endpoint exists for. A live one still does.
    if (claimed.has(sessionId)) {
      failed.push({ sessionId, error: 'Session belongs to an active issue' })
      continue
    }

    const record = await findLocalSession(engine, sessionId)
    if (!record) {
      failed.push({ sessionId, error: 'Session not found' })
      continue
    }

    try {
      await deleteLocalSession(record)
      deleted.push(sessionId)
    } catch (error) {
      failed.push({ sessionId, error: error instanceof Error ? error.message : 'Delete failed' })
    }
  }

  logger.info({ deleted: deleted.length, failed: failed.length }, 'local_sessions_deleted')
  return c.json({ success: true as const, data: { deleted, failed } }, 200)
})

export default sessionsRoute

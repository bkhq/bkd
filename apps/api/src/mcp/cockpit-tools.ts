import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { STATUS_IDS } from '@/config'
import type { StatusId } from '@/config'
import { db, sqlite } from '@/db'
import { buildMatchQuery } from '@/db/fts'
import { issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { toISO } from '@/utils/date'

interface ToolText {
  content: Array<{ type: 'text', text: string }>
}

function ok<T>(value: T): ToolText {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function err(message: string): ToolText {
  return { content: [{ type: 'text', text: `Error: ${message}` }] }
}

const VALID_STATUSES = new Set<string>(STATUS_IDS)

function emptyCounts(): Record<StatusId, number> {
  const out = {} as Record<StatusId, number>
  for (const s of STATUS_IDS) out[s] = 0
  return out
}

// ---------- cockpit_get_stats ----------

export async function cockpitGetStats(): Promise<ToolText> {
  const projectRows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      alias: projectsTable.alias,
    })
    .from(projectsTable)
    .where(eq(projectsTable.isDeleted, 0))
    .orderBy(asc(projectsTable.sortOrder), asc(projectsTable.name))

  const aggRows = await db
    .select({
      projectId: issuesTable.projectId,
      statusId: issuesTable.statusId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(issuesTable)
    .where(and(eq(issuesTable.isDeleted, 0), eq(issuesTable.isHidden, false)))
    .groupBy(issuesTable.projectId, issuesTable.statusId)

  const byProject = new Map<string, Record<StatusId, number>>()
  for (const r of aggRows) {
    const counts = byProject.get(r.projectId) ?? emptyCounts()
    if (VALID_STATUSES.has(r.statusId)) {
      counts[r.statusId as StatusId] = Number(r.count)
    }
    byProject.set(r.projectId, counts)
  }

  const data = projectRows.map((p) => {
    const counts = byProject.get(p.id) ?? emptyCounts()
    const total = STATUS_IDS.reduce((acc, s) => acc + counts[s], 0)
    return {
      projectId: p.id,
      projectName: p.name,
      projectAlias: p.alias,
      counts,
      total,
    }
  })
  return ok(data)
}

// ---------- cockpit_list_issues ----------

export async function cockpitListIssues(params: {
  statuses?: string[]
  projectId?: string
  limit?: number
}): Promise<ToolText> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500)

  const conditions = [
    eq(issuesTable.isDeleted, 0),
    eq(issuesTable.isHidden, false),
  ]
  if (params.statuses && params.statuses.length > 0) {
    const invalid = params.statuses.filter(s => !VALID_STATUSES.has(s))
    if (invalid.length > 0) return err(`invalid statuses: ${invalid.join(', ')}`)
    conditions.push(inArray(issuesTable.statusId, params.statuses as StatusId[]))
  }
  if (params.projectId) {
    conditions.push(eq(issuesTable.projectId, params.projectId))
  }

  const rows = await db
    .select({
      id: issuesTable.id,
      projectId: issuesTable.projectId,
      projectName: projectsTable.name,
      projectAlias: projectsTable.alias,
      statusId: issuesTable.statusId,
      sessionStatus: issuesTable.sessionStatus,
      issueNumber: issuesTable.issueNumber,
      title: issuesTable.title,
      engineType: issuesTable.engineType,
      statusUpdatedAt: issuesTable.statusUpdatedAt,
    })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(issuesTable.statusUpdatedAt))
    .limit(limit)

  return ok(rows.map(r => ({
    ...r,
    statusUpdatedAt: toISO(r.statusUpdatedAt),
  })))
}

// ---------- cockpit_get_issue ----------

export async function cockpitGetIssue(params: { issueId: string }): Promise<ToolText> {
  const [row] = await db
    .select({
      id: issuesTable.id,
      projectId: issuesTable.projectId,
      projectName: projectsTable.name,
      projectAlias: projectsTable.alias,
      statusId: issuesTable.statusId,
      sessionStatus: issuesTable.sessionStatus,
      issueNumber: issuesTable.issueNumber,
      title: issuesTable.title,
      prompt: issuesTable.prompt,
      engineType: issuesTable.engineType,
      model: issuesTable.model,
      totalInputTokens: issuesTable.totalInputTokens,
      totalOutputTokens: issuesTable.totalOutputTokens,
      totalCostUsd: issuesTable.totalCostUsd,
      statusUpdatedAt: issuesTable.statusUpdatedAt,
      createdAt: issuesTable.createdAt,
    })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(and(
      eq(issuesTable.id, params.issueId),
      eq(issuesTable.isDeleted, 0),
    ))
  if (!row) return err(`issue not found: ${params.issueId}`)
  return ok({
    ...row,
    statusUpdatedAt: toISO(row.statusUpdatedAt),
    createdAt: toISO(row.createdAt),
  })
}

// ---------- cockpit_recent_activity ----------

export async function cockpitRecentActivity(params: { limit?: number }): Promise<ToolText> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200)
  const rows = await db
    .select({
      logId: issueLogs.id,
      issueId: issueLogs.issueId,
      issueTitle: issuesTable.title,
      projectAlias: projectsTable.alias,
      entryType: issueLogs.entryType,
      content: issueLogs.content,
      createdAt: issueLogs.createdAt,
    })
    .from(issueLogs)
    .innerJoin(issuesTable, eq(issueLogs.issueId, issuesTable.id))
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(and(
      eq(issueLogs.isDeleted, 0),
      eq(issueLogs.visible, 1),
      eq(issuesTable.isHidden, false),
    ))
    .orderBy(desc(issueLogs.createdAt))
    .limit(limit)

  return ok(rows.map(r => ({
    ...r,
    content: r.content.length > 240 ? `${r.content.slice(0, 240)}…` : r.content,
    createdAt: toISO(r.createdAt),
  })))
}

// ---------- cockpit_search_logs ----------

interface LogSearchRow {
  log_id: string
  issue_id: string
  title: string
  alias: string
  name: string
  entry_type: string
  content: string
  created_at: number
  score: number
}

export interface LogSearchHit {
  logId: string
  issueId: string
  issueTitle: string
  projectAlias: string
  projectName: string
  entryType: string
  content: string
  createdAt: string
  score: number
}

/** Direct FTS5 search — also reusable by HTTP routes. Returns ranked hits. */
export function searchLogs(
  rawQuery: string,
  limit = 30,
  opts: { issueId?: string } = {},
): LogSearchHit[] {
  const ftsQuery = buildMatchQuery(rawQuery)
  if (!ftsQuery) return []
  const cappedLimit = Math.min(Math.max(limit, 1), 200)
  const { issueId } = opts

  try {
    const issueFilter = issueId ? `AND l.issue_id = ?` : ''
    const stmt = sqlite.prepare<LogSearchRow, [string, ...(string[]), number]>(`
      SELECT
        l.id           AS log_id,
        l.issue_id     AS issue_id,
        i.title        AS title,
        p.alias        AS alias,
        p.name         AS name,
        l.entry_type   AS entry_type,
        l.content      AS content,
        l.created_at   AS created_at,
        bm25(issue_logs_fts) AS score
      FROM issue_logs_fts
      JOIN issues_logs l ON l.id = issue_logs_fts.log_id
      JOIN issues i      ON i.id = l.issue_id
      JOIN projects p    ON p.id = i.project_id
      WHERE issue_logs_fts MATCH ?
        AND l.is_deleted = 0
        AND l.visible = 1
        AND i.is_hidden = 0
        AND i.is_deleted = 0
        AND p.is_deleted = 0
        ${issueFilter}
      ORDER BY score
      LIMIT ?
    `)
    const args: any[] = issueId
      ? [ftsQuery, issueId, cappedLimit]
      : [ftsQuery, cappedLimit]
    const rows = stmt.all(...(args as [string, number])) as LogSearchRow[]
    return rows.map(r => ({
      logId: r.log_id,
      issueId: r.issue_id,
      issueTitle: r.title,
      projectAlias: r.alias,
      projectName: r.name,
      entryType: r.entry_type,
      content: r.content.length > 320 ? `${r.content.slice(0, 320)}…` : r.content,
      createdAt: new Date(r.created_at * 1000).toISOString(),
      score: r.score,
    }))
  } catch {
    // Defensive fallback: if FTS5 table is missing (migration not applied
    // yet) or MATCH syntax somehow still fails, degrade to LIKE.
    return likeSearchLogs(rawQuery, cappedLimit, opts)
  }
}

function likeSearchLogs(
  rawQuery: string,
  limit: number,
  opts: { issueId?: string } = {},
): LogSearchHit[] {
  const pattern = `%${rawQuery.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const issueFilter = opts.issueId ? `AND l.issue_id = ?` : ''
  const stmt = sqlite.prepare<LogSearchRow, any[]>(`
    SELECT
      l.id         AS log_id,
      l.issue_id   AS issue_id,
      i.title      AS title,
      p.alias      AS alias,
      p.name       AS name,
      l.entry_type AS entry_type,
      l.content    AS content,
      l.created_at AS created_at,
      0            AS score
    FROM issues_logs l
    JOIN issues i   ON i.id = l.issue_id
    JOIN projects p ON p.id = i.project_id
    WHERE l.is_deleted = 0 AND l.visible = 1
      AND i.is_hidden = 0 AND i.is_deleted = 0 AND p.is_deleted = 0
      AND l.content LIKE ? ESCAPE '\\'
      ${issueFilter}
    ORDER BY l.created_at DESC
    LIMIT ?
  `)
  const args = opts.issueId ? [pattern, opts.issueId, limit] : [pattern, limit]
  const rows = stmt.all(...args) as LogSearchRow[]
  return rows.map(r => ({
    logId: r.log_id,
    issueId: r.issue_id,
    issueTitle: r.title,
    projectAlias: r.alias,
    projectName: r.name,
    entryType: r.entry_type,
    content: r.content.length > 320 ? `${r.content.slice(0, 320)}…` : r.content,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    score: r.score,
  }))
}

export async function cockpitSearchLogs(params: {
  query: string
  limit?: number
}): Promise<ToolText> {
  const q = params.query.trim()
  if (!q) return ok([])
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 200)
  return ok(searchLogs(q, limit))
}

import { sqlite } from '.'

export interface IssueLogSearchHit {
  issueId: string
  logId: string
  turnIndex: number
  matchCount: number
  snippet: string
}

const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 120

// Trigram FTS needs at least three characters; shorter queries use LIKE.
const MIN_FTS_CHARS = 3

/** Best-matching message per issue in a project, best issue first. */
export function searchIssueLogs(projectId: string, query: string, limit: number): IssueLogSearchHit[] {
  const useFts = [...query].length >= MIN_FTS_CHARS
  const match = useFts
    ? `issues_logs_fts MATCH ?`
    : `issues_logs_fts.content LIKE ? ESCAPE '\\'`
  const param = useFts
    ? `"${query.replaceAll('"', '""')}"`
    : `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const rank = useFts ? 'issues_logs_fts.rank' : '0'

  const rows = sqlite.query<{ issueId: string, logId: string, turnIndex: number, matchCount: number, content: string }, [string, string, number]>(`
    WITH hits AS (
      SELECT
        l.rowid AS logRowid,
        l.issue_id AS issueId,
        ${rank} AS rank,
        ROW_NUMBER() OVER (PARTITION BY l.issue_id ORDER BY ${rank}, l.id DESC) AS rn,
        COUNT(*) OVER (PARTITION BY l.issue_id) AS matchCount
      FROM issues_logs_fts
      JOIN issues_logs l ON l.rowid = issues_logs_fts.rowid
      JOIN issues i ON i.id = l.issue_id
      WHERE ${match} AND i.project_id = ? AND i.is_deleted = 0
    )
    SELECT h.issueId, l.id AS logId, l.turn_index AS turnIndex, h.matchCount, l.content
    FROM hits h
    JOIN issues_logs l ON l.rowid = h.logRowid
    WHERE h.rn = 1
    ORDER BY h.rank, l.id DESC
    LIMIT ?
  `).all(param, projectId, limit)

  return rows.map(({ content, ...row }) => ({ ...row, snippet: makeSnippet(content, query) }))
}

/** Re-sync the index; issues_logs rowids may change on VACUUM. */
export function rebuildIssueLogsFts(): void {
  sqlite.transaction(() => {
    sqlite.run('DELETE FROM issues_logs_fts')
    sqlite.run(`
      INSERT INTO issues_logs_fts(rowid, content)
      SELECT rowid, content FROM issues_logs
      WHERE entry_type IN ('user-message', 'assistant-message') AND visible = 1 AND is_deleted = 0
    `)
  })()
}

function makeSnippet(content: string, query: string): string {
  const at = Math.max(0, content.toLowerCase().indexOf(query.toLowerCase()))
  const start = Math.max(0, at - SNIPPET_BEFORE)
  const end = Math.min(content.length, at + query.length + SNIPPET_AFTER)
  const text = content.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`
}

import { sqlite } from '@/db'
import { logger } from '@/logger'

/**
 * Bigram-based FTS5 indexing helpers (SEARCH-001 / PLAN-019).
 *
 * SQLite's stock `unicode61` tokenizer treats CJK runs as a single token,
 * which makes Chinese search useless. We instead pre-tokenize content into
 * overlapping 2-grams at the application layer before writing it to the
 * shadow `issue_logs_fts` virtual table. The same transform is applied
 * to the query side, so CJK queries become a series of bigram terms that
 * the FTS5 engine can match and rank with bm25().
 *
 * ASCII / latin tokens are passed through verbatim (lower-cased) so
 * existing English / code search behaviour stays intact.
 */

export const FTS_TOKENIZER_VERSION = 'bigram-v1'

const CJK_RE = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/

function isCjk(ch: string): boolean {
  return CJK_RE.test(ch)
}

/**
 * Turn arbitrary text into a sequence of FTS-friendly tokens.
 * - CJK runs are split into overlapping 2-grams (e.g. "全文检索" -> "全文 文检 检索").
 *   A single CJK character emits itself as its own token.
 * - Non-CJK runs are split on whitespace + non-word characters and lower-cased.
 *   Tokens of length 1 are dropped to keep the index lean.
 */
export function tokenize(input: string): string[] {
  if (!input) return []
  const tokens: string[] = []
  const len = input.length
  let i = 0
  let asciiBuf = ''

  function flushAscii() {
    if (!asciiBuf) return
    for (const part of asciiBuf.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
      if (part.length >= 2) tokens.push(part)
    }
    asciiBuf = ''
  }

  while (i < len) {
    const ch = input[i]!
    if (isCjk(ch)) {
      flushAscii()
      const prev = i > 0 ? input[i - 1]! : ''
      const next = i + 1 < len ? input[i + 1]! : ''
      if (next && isCjk(next)) {
        tokens.push(ch + next)
      } else if (!prev || !isCjk(prev)) {
        // Isolated single CJK character — keep it as its own token so it
        // remains searchable. When the previous char was CJK, the trailing
        // bigram already covers this position.
        tokens.push(ch)
      }
      i += 1
    } else {
      asciiBuf += ch
      i += 1
    }
  }
  flushAscii()
  return tokens
}

/** Encode source content into the form stored in the FTS shadow row. */
export function encodeContent(content: string): string {
  return tokenize(content).join(' ')
}

/**
 * Build an FTS5 MATCH query from a free-form user query.
 * Strips FTS5 operators, applies the same bigram transform, joins terms
 * with AND, and adds a trailing prefix `*` to the final token so that
 * incremental search feels responsive.
 */
export function buildMatchQuery(raw: string): string {
  const cleaned = raw.replace(/["()*]/g, ' ')
  const tokens = tokenize(cleaned)
    .filter(t => !/^(?:and|or|not|near)$/i.test(t))
  if (tokens.length === 0) return ''
  return tokens
    .map((t, idx) => (idx === tokens.length - 1 ? `${t}*` : t))
    .join(' AND ')
}

// ---------- Persistence ----------

let insertStmt: ReturnType<typeof sqlite.prepare> | null = null
let deleteStmt: ReturnType<typeof sqlite.prepare> | null = null

function getInsert() {
  if (!insertStmt) {
    insertStmt = sqlite.prepare(
      `INSERT INTO issue_logs_fts(log_id, content) VALUES (?, ?)`,
    )
  }
  return insertStmt
}

function getDelete() {
  if (!deleteStmt) {
    deleteStmt = sqlite.prepare(`DELETE FROM issue_logs_fts WHERE log_id = ?`)
  }
  return deleteStmt
}

/** Insert a row into the FTS shadow. Idempotent via delete-then-insert. */
export function indexLog(logId: string, content: string): void {
  try {
    const encoded = encodeContent(content)
    if (!encoded) {
      // Nothing indexable (empty / pure punctuation) — still record an empty
      // row so deletes stay symmetric.
      getDelete().run(logId)
      getInsert().run(logId, '')
      return
    }
    getDelete().run(logId)
    getInsert().run(logId, encoded)
  } catch (err) {
    logger.warn({ err, logId }, 'fts_index_failed')
  }
}

export function removeLog(logId: string): void {
  try {
    getDelete().run(logId)
  } catch (err) {
    logger.warn({ err, logId }, 'fts_remove_failed')
  }
}

// ---------- Backfill / reindex ----------

interface PendingLogRow {
  id: string
  content: string
}

/**
 * Rebuild the entire FTS shadow from `issues_logs`. Idempotent — wipes the
 * shadow and reinserts in batches. Records progress + tokenizer version in
 * `app_settings` so a future tokenizer change can re-trigger the rebuild.
 */
export function reindexAll(batchSize = 1000): { rows: number } {
  sqlite.run(`DELETE FROM issue_logs_fts`)

  const selectBatch = sqlite.prepare<PendingLogRow, [string, number]>(`
    SELECT id, content FROM issues_logs
    WHERE is_deleted = 0 AND visible = 1 AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `)
  const insert = sqlite.prepare(
    `INSERT INTO issue_logs_fts(log_id, content) VALUES (?, ?)`,
  )

  let cursor = ''
  let total = 0
  for (;;) {
    const rows = selectBatch.all(cursor, batchSize) as PendingLogRow[]
    if (rows.length === 0) break
    const insertMany = sqlite.transaction((batch: PendingLogRow[]) => {
      for (const row of batch) {
        insert.run(row.id, encodeContent(row.content))
      }
    })
    insertMany(rows)
    total += rows.length
    cursor = rows.at(-1)!.id
    if (rows.length < batchSize) break
  }
  return { rows: total }
}

/**
 * Run reindexAll() only when the persisted tokenizer version differs from
 * the compiled-in version. Cheap to call on every boot.
 */
export function ensureFtsTokenizerVersion(): { rebuilt: boolean, rows: number } {
  try {
    sqlite.run(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0
    )`)
    const row = sqlite
      .prepare(`SELECT value FROM app_settings WHERE key = 'fts.tokenizer_version'`)
      .get() as { value?: string } | undefined
    if (row?.value === FTS_TOKENIZER_VERSION) {
      return { rebuilt: false, rows: 0 }
    }
    logger.info(
      { from: row?.value ?? '(none)', to: FTS_TOKENIZER_VERSION },
      'fts_rebuild_starting',
    )
    const result = reindexAll()
    const now = Math.floor(Date.now() / 1000)
    sqlite
      .prepare(
        `INSERT INTO app_settings(key, value, created_at, updated_at)
         VALUES ('fts.tokenizer_version', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(FTS_TOKENIZER_VERSION, now, now)
    logger.info({ rows: result.rows }, 'fts_rebuild_completed')
    return { rebuilt: true, rows: result.rows }
  } catch (err) {
    logger.error({ err }, 'fts_rebuild_failed')
    return { rebuilt: false, rows: 0 }
  }
}

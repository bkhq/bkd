/**
 * Idempotent database repair.
 *
 * Brings a database fully up to date using only `bun:sqlite` + `node:crypto`
 * (no `drizzle-orm`), so it works in dev, full compiled binaries, and package
 * mode.
 *
 * Applied state is resolved **by journal position**, not by per-file hash.
 * Drizzle applies migrations strictly in `_journal.json` order and inserts
 * exactly one `__drizzle_migrations` row per success, so `K` recorded rows
 * means the first `K` journal entries already ran (clean-prefix invariant).
 * Repair therefore:
 *
 *  - treats journal entries `[0, K)` as already applied — it never re-executes
 *    their SQL (so a re-aligned or destructive historical migration, e.g.
 *    `0006` dropping `priority`, is never replayed) and only normalizes their
 *    recorded hash to the current file content;
 *  - applies entries `[K, N)` with per-statement tolerance of
 *    "table/index already exists" and "duplicate column name", so a database
 *    whose schema is ahead of its `__drizzle_migrations` watermark (the
 *    real-world "stuck chain" case) still converges.
 *
 * This is robust to both the ENG-009 migration-history re-alignment (file
 * content changed) and a non-monotonic journal `when` (ENG-010), neither of
 * which can be handled by hash- or timestamp-watermark matching.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveDbPath, resolveMigrationsDir } from './migrations-source'

/** Errors safe to skip per-statement: the schema change is already present. */
const TOLERATED = /already exists|duplicate column name/i

export interface RepairResult {
  /** Migrations newly executed and recorded this run. */
  applied: number
  /** Already-applied prefix migrations reconciled (not re-executed). */
  skipped: number
}

interface Journal {
  entries: Array<{ idx: number, when: number, tag: string }>
}

export function repairDatabase(
  opts: { dbPath?: string, migrationsDir?: string } = {},
): RepairResult {
  const dbPath = opts.dbPath ?? resolveDbPath()
  if (!existsSync(dbPath)) {
    // No database yet — normal startup will create and migrate it.
    return { applied: 0, skipped: 0 }
  }

  const migrationsDir = opts.migrationsDir ?? resolveMigrationsDir().dir
  const journalFile = resolve(migrationsDir, 'meta/_journal.json')
  if (!existsSync(journalFile)) {
    throw new Error(`Migrations journal not found: ${journalFile}`)
  }
  const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as Journal
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)

  const sqlite = new Database(dbPath)
  try {
    sqlite.run('PRAGMA journal_mode = WAL')
    sqlite.run(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`)

    const recorded = (
      sqlite.query('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }
    ).n

    // Clean-prefix invariant: K recorded rows ⇒ first K journal entries ran.
    const prefixLen = Math.min(recorded, entries.length)

    const hashOf = (entry: { tag: string }): string => {
      const sqlFile = resolve(migrationsDir, `${entry.tag}.sql`)
      if (!existsSync(sqlFile)) {
        throw new Error(`Migration file not found: ${sqlFile}`)
      }
      return createHash('sha256').update(readFileSync(sqlFile, 'utf8')).digest('hex')
    }

    // foreign_keys must be toggled outside any transaction.
    sqlite.run('PRAGMA foreign_keys = OFF')

    // Reconcile the already-applied prefix: rewrite __drizzle_migrations to
    // exactly the first `prefixLen` entries with current file hashes. Their
    // SQL is NEVER re-executed.
    sqlite.run('BEGIN')
    try {
      sqlite.run('DELETE FROM __drizzle_migrations')
      for (let i = 0; i < prefixLen; i++) {
        const entry = entries[i]!
        sqlite.run(
          'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
          [hashOf(entry), entry.when],
        )
      }
      sqlite.run('COMMIT')
    } catch (err) {
      sqlite.run('ROLLBACK')
      throw new Error(
        `Repair failed reconciling applied prefix: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let applied = 0

    // Apply the remaining entries with per-statement tolerance.
    for (let i = prefixLen; i < entries.length; i++) {
      const entry = entries[i]!
      const sqlFile = resolve(migrationsDir, `${entry.tag}.sql`)
      if (!existsSync(sqlFile)) {
        throw new Error(`Migration file not found: ${sqlFile}`)
      }
      const sql = readFileSync(sqlFile, 'utf8')
      const hash = createHash('sha256').update(sql).digest('hex')

      const statements = sql
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(Boolean)

      sqlite.run('BEGIN')
      try {
        for (const stmt of statements) {
          try {
            sqlite.run(stmt)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (TOLERATED.test(msg)) continue
            throw err
          }
        }
        sqlite.run(
          'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
          [hash, entry.when],
        )
        sqlite.run('COMMIT')
        applied++
      } catch (err) {
        sqlite.run('ROLLBACK')
        throw new Error(
          `Repair failed at ${entry.tag}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    sqlite.run('PRAGMA foreign_keys = ON')
    return { applied, skipped: prefixLen }
  } finally {
    sqlite.close()
  }
}

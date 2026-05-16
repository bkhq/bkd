/**
 * Idempotent database repair.
 *
 * Re-applies pending Drizzle migrations using only `bun:sqlite` +
 * `node:crypto` (no `drizzle-orm`), so it works in dev, full compiled
 * binaries, and package mode. Unlike the normal startup migrator
 * (`db/index.ts` `runMigrations`), repair is tolerant per-statement of
 * "table/index already exists" and "duplicate column name", and records each
 * migration's hash in `__drizzle_migrations` so subsequent normal startups
 * are consistent.
 *
 * This recovers databases whose `__drizzle_migrations` is hash-inconsistent
 * with the (re-aligned) migration history, where the normal migrator silently
 * aborts the chain on the first "already exists" and leaves later migrations
 * (e.g. column additions) unapplied.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveDbPath, resolveMigrationsDir } from './migrations-source'

/** Errors safe to skip per-statement: the schema change is already present. */
const TOLERATED = /already exists|duplicate column name/i

export interface RepairResult {
  /** Migrations whose hash was newly recorded this run. */
  applied: number
  /** Migrations already recorded (hash match) and skipped. */
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

  const sqlite = new Database(dbPath)
  try {
    sqlite.run('PRAGMA journal_mode = WAL')
    sqlite.run(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )`)

    const appliedHashes = new Set(
      (sqlite.query('SELECT hash FROM __drizzle_migrations').all() as Array<{ hash: string }>)
        .map(r => r.hash),
    )

    let applied = 0
    let skipped = 0

    // foreign_keys must be toggled outside any transaction.
    sqlite.run('PRAGMA foreign_keys = OFF')

    for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
      const sqlFile = resolve(migrationsDir, `${entry.tag}.sql`)
      if (!existsSync(sqlFile)) {
        throw new Error(`Migration file not found: ${sqlFile}`)
      }
      const sql = readFileSync(sqlFile, 'utf8')
      const hash = createHash('sha256').update(sql).digest('hex')
      if (appliedHashes.has(hash)) {
        skipped++
        continue
      }

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
    return { applied, skipped }
  } finally {
    sqlite.close()
  }
}

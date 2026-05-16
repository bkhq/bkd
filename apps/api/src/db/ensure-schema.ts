/**
 * Generic schema safety-net.
 *
 * Source of truth = the highest-numbered Drizzle snapshot
 * (`meta/NNNN_snapshot.json`), which is available in dev, package, and
 * compiled-binary modes. Uses only `bun:sqlite` + `node:fs` (no
 * `drizzle-orm`), consistent with `repair.ts`.
 *
 * Applies **additive, idempotent** repairs only — create missing tables,
 * add missing columns, create missing indexes. Destructive divergence
 * (extra / renamed / retyped / dropped objects) is reported, never changed:
 * that is migration history's responsibility, and auto-dropping is
 * irreversible.
 *
 * This converges any database to the latest schema regardless of how
 * inconsistent `__drizzle_migrations` is, so neither a re-aligned history
 * nor a future journal/hash drift can leave a DB unbootable.
 */
import type { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Errors safe to skip per-statement: the change is already present. */
const TOLERATED = /already exists|duplicate column name/i

export interface SchemaFixResult {
  tablesCreated: string[]
  columnsAdded: string[]
  indexesCreated: string[]
  /** Human-readable notes about non-additive divergence (not changed). */
  divergent: string[]
}

export function emptySchemaFix(): SchemaFixResult {
  return { tablesCreated: [], columnsAdded: [], indexesCreated: [], divergent: [] }
}

interface SnapshotColumn {
  name: string
  type: string
  primaryKey?: boolean
  notNull?: boolean
  autoincrement?: boolean
  default?: string | number | boolean
}
interface SnapshotIndex {
  name: string
  columns: string[]
  isUnique?: boolean
  where?: string
}
interface SnapshotTable {
  name: string
  columns: Record<string, SnapshotColumn>
  indexes: Record<string, SnapshotIndex>
  compositePrimaryKeys?: Record<string, { columns: string[] }>
}
interface Snapshot {
  tables: Record<string, SnapshotTable>
}

/** Highest-numbered `meta/NNNN_snapshot.json`, or null when none exists. */
export function findLatestSnapshot(migrationsDir: string): string | null {
  const metaDir = resolve(migrationsDir, 'meta')
  if (!existsSync(metaDir)) return null
  const snaps = readdirSync(metaDir)
    .filter(f => /^\d+_snapshot\.json$/.test(f))
    .sort()
  const last = snaps.at(-1)
  return last ? resolve(metaDir, last) : null
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function columnDef(col: SnapshotColumn, forCreate: boolean): string {
  let def = `${quoteIdent(col.name)} ${col.type}`
  if (forCreate && col.primaryKey) {
    def += ' PRIMARY KEY'
    if (col.autoincrement) def += ' AUTOINCREMENT'
  }
  const hasDefault = col.default !== undefined
  // SQLite forbids ADD COLUMN NOT NULL without a default; degrade to nullable.
  if (col.notNull && (forCreate || hasDefault)) def += ' NOT NULL'
  if (hasDefault) def += ` DEFAULT ${String(col.default)}`
  return def
}

function liveColumns(sqlite: Database, table: string): Set<string> {
  const rows = sqlite
    .query(`PRAGMA table_info(${quoteIdent(table)})`)
    .all() as Array<{ name: string }>
  return new Set(rows.map(r => r.name))
}

function objectExists(sqlite: Database, type: 'table' | 'index', name: string): boolean {
  const row = sqlite
    .query(`SELECT name FROM sqlite_master WHERE type = ? AND name = ?`)
    .get(type, name) as { name: string } | null
  return !!row
}

function runTolerant(sqlite: Database, sql: string): void {
  try {
    sqlite.run(sql)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (TOLERATED.test(msg)) return
    throw err
  }
}

/**
 * Bring `sqlite` up to the latest snapshot. Additive-only; safe to call
 * repeatedly. `foreign_keys` is left untouched (caller controls it).
 */
export function ensureSchema(
  sqlite: Database,
  migrationsDir: string,
): SchemaFixResult {
  const result = emptySchemaFix()

  const snapPath = findLatestSnapshot(migrationsDir)
  if (!snapPath) return result

  const snapshot = JSON.parse(readFileSync(snapPath, 'utf8')) as Snapshot
  const tables = snapshot.tables ?? {}

  for (const table of Object.values(tables)) {
    const cols = Object.values(table.columns)

    if (!objectExists(sqlite, 'table', table.name)) {
      const colDefs = cols.map(c => columnDef(c, true))
      const compositePks = Object.values(table.compositePrimaryKeys ?? {})
      for (const pk of compositePks) {
        colDefs.push(`PRIMARY KEY (${pk.columns.map(quoteIdent).join(', ')})`)
      }
      runTolerant(
        sqlite,
        `CREATE TABLE ${quoteIdent(table.name)} (${colDefs.join(', ')})`,
      )
      result.tablesCreated.push(table.name)
    } else {
      const live = liveColumns(sqlite, table.name)
      for (const col of cols) {
        if (!live.has(col.name)) {
          runTolerant(
            sqlite,
            `ALTER TABLE ${quoteIdent(table.name)} ADD COLUMN ${columnDef(col, false)}`,
          )
          result.columnsAdded.push(`${table.name}.${col.name}`)
        }
      }
      // Report (do not change) columns present in the DB but not the snapshot.
      const expected = new Set(cols.map(c => c.name))
      for (const liveCol of live) {
        if (!expected.has(liveCol)) {
          result.divergent.push(`${table.name}.${liveCol} (extra column, not removed)`)
        }
      }
    }

    for (const idx of Object.values(table.indexes)) {
      if (objectExists(sqlite, 'index', idx.name)) continue
      const unique = idx.isUnique ? 'UNIQUE ' : ''
      const where = idx.where ? ` WHERE ${idx.where}` : ''
      runTolerant(
        sqlite,
        `CREATE ${unique}INDEX ${quoteIdent(idx.name)} ON ${quoteIdent(table.name)} `
        + `(${idx.columns.map(quoteIdent).join(', ')})${where}`,
      )
      result.indexesCreated.push(idx.name)
    }
  }

  return result
}

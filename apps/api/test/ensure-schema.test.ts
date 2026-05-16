/**
 * Tests for the generic snapshot-driven schema safety-net (ENG-011).
 */
import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ensureSchema, findLatestSnapshot } from '@/db/ensure-schema'

const workDirs: string[] = []

function snapshot() {
  return JSON.stringify({
    version: '6',
    dialect: 'sqlite',
    tables: {
      kept: {
        name: 'kept',
        columns: {
          id: { name: 'id', type: 'text', primaryKey: true, notNull: true },
          added: { name: 'added', type: 'text', notNull: true, default: `'x'` },
        },
        indexes: {
          kept_added_idx: { name: 'kept_added_idx', columns: ['added'], isUnique: false },
        },
        compositePrimaryKeys: {},
      },
      created_tbl: {
        name: 'created_tbl',
        columns: {
          id: { name: 'id', type: 'text', primaryKey: true, notNull: true },
          n: { name: 'n', type: 'integer', notNull: true, default: 0 },
        },
        indexes: {},
        compositePrimaryKeys: {},
      },
    },
  })
}

function makeFixture(withSnapshot = true) {
  const root = mkdtempSync(resolve(tmpdir(), 'bkd-ensure-'))
  workDirs.push(root)
  const migrationsDir = resolve(root, 'migrations')
  mkdirSync(resolve(migrationsDir, 'meta'), { recursive: true })
  if (withSnapshot) {
    writeFileSync(resolve(migrationsDir, 'meta/0001_snapshot.json'), snapshot())
  }
  const dbPath = resolve(root, 'test.db')
  const db = new Database(dbPath)
  // `kept` exists but lacks `added`, and has an extra `legacy` column.
  db.run('CREATE TABLE kept (id text PRIMARY KEY, legacy text)')
  db.close()
  return { dbPath, migrationsDir }
}

function columns(dbPath: string, table: string): string[] {
  const db = new Database(dbPath)
  try {
    return (db.query(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>)
      .map(r => r.name)
      .sort()
  } finally {
    db.close()
  }
}

afterAll(() => {
  for (const dir of workDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

let fx: { dbPath: string, migrationsDir: string }
beforeEach(() => {
  fx = makeFixture()
})

describe('ensureSchema', () => {
  test('creates missing table, adds missing column, creates index, reports divergence', () => {
    const db = new Database(fx.dbPath)
    const r = ensureSchema(db, fx.migrationsDir)
    db.close()

    expect(r.tablesCreated).toEqual(['created_tbl'])
    expect(r.columnsAdded).toEqual(['kept.added'])
    expect(r.indexesCreated).toEqual(['kept_added_idx'])
    expect(r.divergent).toEqual(['kept.legacy (extra column, not removed)'])

    expect(columns(fx.dbPath, 'kept')).toEqual(['added', 'id', 'legacy'])
    expect(columns(fx.dbPath, 'created_tbl')).toEqual(['id', 'n'])
  })

  test('is idempotent — a second run is a clean no-op', () => {
    const db = new Database(fx.dbPath)
    ensureSchema(db, fx.migrationsDir)
    const second = ensureSchema(db, fx.migrationsDir)
    db.close()

    expect(second.tablesCreated).toEqual([])
    expect(second.columnsAdded).toEqual([])
    expect(second.indexesCreated).toEqual([])
    // `legacy` is still reported (informational, not removed).
    expect(second.divergent).toEqual(['kept.legacy (extra column, not removed)'])
  })

  test('no-op when no snapshot is present', () => {
    const f = makeFixture(false)
    expect(findLatestSnapshot(f.migrationsDir)).toBeNull()
    const db = new Database(f.dbPath)
    const r = ensureSchema(db, f.migrationsDir)
    db.close()
    expect(r).toEqual({
      tablesCreated: [],
      columnsAdded: [],
      indexesCreated: [],
      divergent: [],
    })
  })
})

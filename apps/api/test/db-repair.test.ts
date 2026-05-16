/**
 * Tests for the idempotent database repair (`bkd fix-db`).
 *
 * Uses a self-contained migrations fixture so the test does not depend on the
 * real schema/migration history.
 */
import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { repairDatabase } from '@/db/repair'

const workDirs: string[] = []

function makeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'bkd-repair-'))
  workDirs.push(root)
  const migrationsDir = resolve(root, 'migrations')
  mkdirSync(resolve(migrationsDir, 'meta'), { recursive: true })

  writeFileSync(
    resolve(migrationsDir, '0001_init.sql'),
    'CREATE TABLE t (id text PRIMARY KEY);',
  )
  writeFileSync(
    resolve(migrationsDir, '0002_add_col.sql'),
    'ALTER TABLE t ADD COLUMN c text;',
  )
  writeFileSync(
    resolve(migrationsDir, 'meta/_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [
        { idx: 1, version: '6', when: 1000, tag: '0001_init', breakpoints: true },
        { idx: 2, version: '6', when: 2000, tag: '0002_add_col', breakpoints: true },
      ],
    }),
  )

  const dbPath = resolve(root, 'test.db')
  return { dbPath, migrationsDir }
}

function columns(dbPath: string, table: string): string[] {
  const db = new Database(dbPath)
  try {
    return (db.query(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>)
      .map(r => r.name)
  } finally {
    db.close()
  }
}

function migrationCount(dbPath: string): number {
  const db = new Database(dbPath)
  try {
    const row = db.query('SELECT count(*) as n FROM __drizzle_migrations').get() as { n: number }
    return row.n
  } finally {
    db.close()
  }
}

let fixture: { dbPath: string, migrationsDir: string }

beforeEach(() => {
  fixture = makeFixture()
})

afterAll(() => {
  for (const dir of workDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
})

describe('repairDatabase', () => {
  test('returns no-op when the database file does not exist', () => {
    const result = repairDatabase({
      dbPath: resolve(fixture.migrationsDir, 'does-not-exist.db'),
      migrationsDir: fixture.migrationsDir,
    })
    expect(result).toEqual({ applied: 0, skipped: 0 })
  })

  test('applies all pending migrations on an empty database', () => {
    // Create an empty DB file.
    new Database(fixture.dbPath).close()

    const result = repairDatabase(fixture)
    expect(result).toEqual({ applied: 2, skipped: 0 })
    expect(columns(fixture.dbPath, 't').sort()).toEqual(['c', 'id'])
    expect(migrationCount(fixture.dbPath)).toBe(2)
  })

  test('is idempotent — a second run skips everything', () => {
    new Database(fixture.dbPath).close()
    repairDatabase(fixture)

    const second = repairDatabase(fixture)
    expect(second).toEqual({ applied: 0, skipped: 2 })
    expect(migrationCount(fixture.dbPath)).toBe(2)
  })

  test('tolerates pre-existing schema with no migration records', () => {
    // Simulate a DB whose objects exist but __drizzle_migrations is
    // inconsistent (the real-world cause of the unapplied-0020 bug):
    // table `t` already exists, the late column does NOT, and nothing is
    // recorded as applied.
    const db = new Database(fixture.dbPath)
    db.run('CREATE TABLE t (id text PRIMARY KEY)')
    db.close()

    const result = repairDatabase(fixture)
    // 0001's CREATE TABLE is tolerated (already exists) but still recorded;
    // 0002 adds the missing column.
    expect(result).toEqual({ applied: 2, skipped: 0 })
    expect(columns(fixture.dbPath, 't').sort()).toEqual(['c', 'id'])
    expect(migrationCount(fixture.dbPath)).toBe(2)

    // And a follow-up run is a clean no-op.
    expect(repairDatabase(fixture)).toEqual({ applied: 0, skipped: 2 })
  })

  test('aborts loudly on a genuinely broken migration', () => {
    new Database(fixture.dbPath).close()
    writeFileSync(
      resolve(fixture.migrationsDir, '0002_add_col.sql'),
      'THIS IS NOT VALID SQL;',
    )
    expect(() => repairDatabase(fixture)).toThrow(/Repair failed at 0002_add_col/)
    // 0001 still committed before the failure.
    expect(migrationCount(fixture.dbPath)).toBe(1)
  })
})

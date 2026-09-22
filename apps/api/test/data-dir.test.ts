import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { resolveDbPath } from '@/db/migrations-source'
import { DATA_DIR, resolveDataDir, ROOT_DIR } from '@/root'
import { UPLOAD_DIR } from '@/uploads'

/**
 * Guards the data-directory contract: every `data/`-relative path hangs off a single
 * DATA_DIR (`BKD_DATA_DIR` ?? `<ROOT_DIR>/data`) and none of them derive from the process
 * cwd, which lode changes on every upgrade (docs/deployment.md).
 */
describe('data directory resolution', () => {
  test('defaults to <ROOT_DIR>/data', () => {
    expect(resolveDataDir({})).toBe(resolve(ROOT_DIR, 'data'))
  })

  test('BKD_DATA_DIR overrides the default', () => {
    expect(resolveDataDir({ BKD_DATA_DIR: '/srv/bkd-data' })).toBe('/srv/bkd-data')
  })
})

describe('upload directory', () => {
  test('hangs off DATA_DIR, not the cwd', () => {
    expect(UPLOAD_DIR).toBe(resolve(DATA_DIR, 'uploads'))
  })
})

describe('database path', () => {
  const original = process.env.DB_PATH

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DB_PATH
    } else {
      process.env.DB_PATH = original
    }
  })

  test('defaults to <DATA_DIR>/db/bkd.db', () => {
    delete process.env.DB_PATH
    expect(resolveDbPath()).toBe(resolve(DATA_DIR, 'db/bkd.db'))
  })

  test('resolves a relative DB_PATH inside DATA_DIR', () => {
    process.env.DB_PATH = 'db/custom.db'
    expect(resolveDbPath()).toBe(resolve(DATA_DIR, 'db/custom.db'))
  })

  test('uses an absolute DB_PATH verbatim', () => {
    process.env.DB_PATH = '/srv/bkd/custom.db'
    expect(resolveDbPath()).toBe('/srv/bkd/custom.db')
  })

  test('falls back to the pre-DATA_DIR location rather than opening an empty database', () => {
    // A relative DB_PATH used to resolve against ROOT_DIR. An install carrying the old
    // `data/db/...` form must keep its populated file instead of creating an empty one.
    const relative = `data/db/legacy-${process.pid}.db`
    const legacyPath = resolve(ROOT_DIR, relative)
    mkdirSync(dirname(legacyPath), { recursive: true })
    writeFileSync(legacyPath, '')

    try {
      process.env.DB_PATH = relative
      expect(resolveDbPath()).toBe(legacyPath)
      expect(resolveDbPath()).not.toBe(resolve(DATA_DIR, relative))
    } finally {
      rmSync(legacyPath, { force: true })
    }
  })
})

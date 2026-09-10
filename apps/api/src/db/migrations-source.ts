/**
 * Side-effect-free resolution of the database path and the directory that
 * holds the Drizzle migration files (`*.sql` + `meta/_journal.json`).
 *
 * Importing this module must NOT open the database or run migrations — it is
 * shared by the normal startup path (`db/index.ts`) and the `fix-db` repair
 * path (`db/repair.ts`), the latter of which must run before the startup
 * migrate+verify side-effect.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { APP_DIR, DATA_DIR, ROOT_DIR } from '@/root'
import { embeddedMigrations } from './embedded-migrations'

/**
 * Absolute path to the SQLite database file.
 *
 * `DATA_DIR` is the single base: an absolute `DB_PATH` is used verbatim, a relative one
 * resolves inside `DATA_DIR`, and the default is `<DATA_DIR>/db/bkd.db`.
 *
 * Compatibility: a relative `DB_PATH` used to resolve against `ROOT_DIR`, so the shipped
 * example `data/db/bkd.db` meant `<ROOT_DIR>/data/db/bkd.db`. When the new location holds
 * no database but the old one does, keep the old file — creating an empty database beside
 * a populated one looks exactly like data loss.
 */
export function resolveDbPath(): string {
  const raw = process.env.DB_PATH
  if (!raw) return resolve(DATA_DIR, 'db/bkd.db')
  if (raw.startsWith('/')) return raw

  const path = resolve(DATA_DIR, raw)
  if (existsSync(path)) return path

  const legacyPath = resolve(ROOT_DIR, raw)
  return existsSync(legacyPath) ? legacyPath : path
}

export interface MigrationsSource {
  /** Directory containing migration `*.sql` files and `meta/_journal.json`. */
  dir: string
  /** True when migrations were materialized from the embedded binary map. */
  embedded: boolean
}

/**
 * Resolve the migrations directory.
 *
 * - Package mode: `APP_DIR/migrations`.
 * - Dev / non-compiled: `apps/api/drizzle`.
 * - Compiled binary (no filesystem migrations): the embedded migration map is
 *   written to a temp directory and that path is returned.
 */
export function resolveMigrationsDir(): MigrationsSource {
  const fsFolder = APP_DIR
    ? resolve(APP_DIR, 'migrations')
    : resolve(ROOT_DIR, 'apps/api/drizzle')

  if (existsSync(resolve(fsFolder, 'meta/_journal.json'))) {
    return { dir: fsFolder, embedded: false }
  }

  if (embeddedMigrations.size > 0) {
    const tmp = resolve(tmpdir(), 'bkd-migrations')
    for (const [name, content] of embeddedMigrations) {
      const target = resolve(tmp, name)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
    return { dir: tmp, embedded: true }
  }

  throw new Error(
    'No migrations available (missing drizzle/ folder and no embedded migrations)',
  )
}

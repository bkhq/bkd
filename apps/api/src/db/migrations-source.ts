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
import { APP_DIR, ROOT_DIR } from '@/root'
import { embeddedMigrations } from './embedded-migrations'

/** Absolute path to the SQLite database file. */
export function resolveDbPath(): string {
  const raw = process.env.DB_PATH || 'data/db/bkd.db'
  return raw.startsWith('/') ? raw : resolve(ROOT_DIR, raw)
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

/**
 * Side-effect-free introspection of the Drizzle schema into a plain
 * `[tableName, columnNames[]]` list. Kept separate from `db/index.ts` (which
 * runs migrate + verify at import time) so it is unit-testable in isolation.
 *
 * Uses the documented drizzle API (`is` + `getTableConfig`) rather than the
 * internal `._` accessor, which is `undefined` in drizzle-orm 0.45.2 and made
 * the startup schema self-heal a no-op (ENG-016).
 */
import { is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

/** `[tableName, columnNames[]]` for every SQLite table exported from the schema. */
export function expectedSchemaTables(): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = []
  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) continue
    const cfg = getTableConfig(value)
    out.push([cfg.name, cfg.columns.map(c => c.name)])
  }
  return out
}

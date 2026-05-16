/**
 * Guard for the Drizzle migration journal (`meta/_journal.json`).
 *
 * Drizzle's bun-sqlite migrator decides what to apply by a `created_at`
 * watermark (`sqlite-core` `dialect.migrate`: apply iff
 * `last.created_at < migration.when`). A journal whose `when` is not strictly
 * increasing by `idx` makes the migrator permanently skip any later entry that
 * regresses below the running max — exactly the ENG-010 incident, where
 * `0020`'s `when` was below `0019`'s and `0020` was never applied.
 *
 * This test fails fast if a future migration is appended (or hand-edited)
 * with a non-monotonic `when`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveMigrationsDir } from '@/db/migrations-source'

interface Journal {
  entries: Array<{ idx: number, when: number, tag: string }>
}

describe('migration journal', () => {
  test('_journal.json when is strictly increasing by idx', () => {
    const dir = resolveMigrationsDir().dir
    const journal = JSON.parse(
      readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8'),
    ) as Journal

    const entries = [...journal.entries].sort((a, b) => a.idx - b.idx)

    const violations: string[] = []
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!
      const cur = entries[i]!
      if (cur.when <= prev.when) {
        violations.push(
          `${cur.tag} (when=${cur.when}) is not > ${prev.tag} (when=${prev.when})`,
        )
      }
    }

    expect(violations).toEqual([])
  })
})

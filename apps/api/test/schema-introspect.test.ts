import { describe, expect, test } from 'bun:test'
import { expectedSchemaTables } from '@/db/schema-introspect'

/**
 * Guards ENG-016: the startup schema self-heal depends on this introspection
 * actually finding tables/columns. The previous `._` accessor returned 0
 * tables under drizzle-orm 0.45.2, silently disabling the safety net.
 */
describe('expectedSchemaTables', () => {
  test('detects all schema tables', () => {
    const tables = expectedSchemaTables()
    const names = tables.map(([n]) => n)
    expect(names).toContain('issues')
    expect(names).toContain('projects')
    expect(tables.length).toBeGreaterThanOrEqual(10)
  })

  test('issues table exposes engine_profile_id (regression for the missing-column bug)', () => {
    const issues = expectedSchemaTables().find(([n]) => n === 'issues')
    expect(issues?.[1]).toContain('engine_profile_id')
  })
})

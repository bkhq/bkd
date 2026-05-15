import { describe, expect, test } from 'bun:test'
import { expectSuccess, get } from './helpers'
import './setup'

describe('GET /api/processes/capacity', () => {
  // The ProcessManager singleton and the test DB are shared across the whole
  // `bun test` run, so asserting a globally empty state here is unsound — it
  // depends on test-file ordering. Assert the endpoint's computation
  // invariants instead, which is order-independent and a stronger logic check.
  test('returns active summary and available execution slots', async () => {
    const result = await get<{
      summary: {
        totalActive: number
        byState: Record<string, number>
        byEngine: Record<string, number>
        byProject: Record<string, { projectName: string, count: number }>
      }
      maxConcurrent: number
      availableSlots: number | null
      canStartNewExecution: boolean
    }>('/api/processes/capacity')

    expect(result.status).toBe(200)
    const data = expectSuccess(result)

    const { summary } = data
    expect(typeof summary.totalActive).toBe('number')
    expect(summary.totalActive).toBeGreaterThanOrEqual(0)

    // byState / byProject counts must each sum to totalActive.
    const sum = (counts: Record<string, number>): number =>
      Object.values(counts).reduce((a, b) => a + b, 0)
    expect(sum(summary.byState)).toBe(summary.totalActive)
    expect(sum(summary.byEngine)).toBe(summary.totalActive)
    expect(
      Object.values(summary.byProject).reduce((a, p) => a + p.count, 0),
    ).toBe(summary.totalActive)

    expect(typeof data.maxConcurrent).toBe('number')
    expect(data.maxConcurrent).toBeGreaterThanOrEqual(1)

    // Slot math: bounded by maxConcurrent, never negative.
    expect(data.availableSlots).toBe(
      Math.max(0, data.maxConcurrent - summary.totalActive),
    )
    expect(data.canStartNewExecution).toBe(
      data.availableSlots === null || data.availableSlots > 0,
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { parseRateLimits } from '@/engines/executors/codex/usage'

describe('parseRateLimits', () => {
  test('parses the camelCase app-server snapshot', () => {
    // Shape of GetAccountRateLimitsResponse.rateLimits (app-server v2 schema)
    expect(parseRateLimits({
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1789218429 },
      secondary: { usedPercent: 48, windowDurationMins: 10080, resetsAt: 1789318429 },
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      planType: 'pro',
    })).toEqual({
      primary: { usedPercentage: 12, windowMinutes: 300, resetsAt: '2026-09-12T13:07:09.000Z' },
      secondary: { usedPercentage: 48, windowMinutes: 10080, resetsAt: '2026-09-13T16:53:49.000Z' },
      planType: 'pro',
    })
  })

  test('parses the snake_case snapshot persisted in session rollouts', () => {
    expect(parseRateLimits({
      limit_id: 'codex',
      primary: { used_percent: 48, window_minutes: 10080, resets_at: 1789218429 },
      secondary: null,
      plan_type: 'pro',
    })).toEqual({
      primary: { usedPercentage: 48, windowMinutes: 10080, resetsAt: '2026-09-12T13:07:09.000Z' },
      secondary: null,
      planType: 'pro',
    })
  })

  test('keeps a window without reset or duration metadata', () => {
    expect(parseRateLimits({ primary: { usedPercent: 3 } })).toEqual({
      primary: { usedPercentage: 3, windowMinutes: null, resetsAt: null },
      secondary: null,
      planType: null,
    })
  })

  test('drops malformed windows and tolerates non-object input', () => {
    const empty = { primary: null, secondary: null, planType: null }
    expect(parseRateLimits(undefined)).toEqual(empty)
    expect(parseRateLimits('nope')).toEqual(empty)
    expect(parseRateLimits({ primary: { usedPercent: 'high' }, secondary: 7, planType: 12 })).toEqual(empty)
    expect(parseRateLimits({ primary: { usedPercent: 5, resetsAt: 'soon' } })).toEqual({
      ...empty,
      primary: { usedPercentage: 5, windowMinutes: null, resetsAt: null },
    })
  })
})

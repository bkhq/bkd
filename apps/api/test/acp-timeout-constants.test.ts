import { describe, expect, test } from 'bun:test'
import { ACP_PROMPT_TIMEOUT_MS } from '@/engines/issue/constants'

describe('ACP timeout constants regression', () => {
  test('ACP_PROMPT_TIMEOUT_MS is 30 minutes (not 10)', () => {
    // Previously 10 minutes — too short for opencode deep-thinking sessions.
    // Bumped to 30 minutes so long reasoning/tool chains don't get cut off.
    expect(ACP_PROMPT_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })
})

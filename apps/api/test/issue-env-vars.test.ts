import { describe, expect, it } from 'bun:test'
import { issueEnvVars } from '@/engines/issue/utils/helpers'

describe('issueEnvVars', () => {
  it('gives the engine its own issue ids next to the configured vars', () => {
    expect(issueEnvVars({ FOO: '1' }, 'proj1234', 'iss12345')).toEqual({
      FOO: '1',
      BKD_PROJECT_ID: 'proj1234',
      BKD_ISSUE_ID: 'iss12345',
    })
  })

  it('does not let a configured var impersonate another issue', () => {
    expect(issueEnvVars({ BKD_ISSUE_ID: 'other' }, 'p', 'mine').BKD_ISSUE_ID).toBe('mine')
    expect(issueEnvVars(undefined, 'p', 'i')).toEqual({ BKD_PROJECT_ID: 'p', BKD_ISSUE_ID: 'i' })
  })
})

import type { TFunction } from 'i18next'
import { UPGRADE_DRAINING_CODE } from '@bkd/shared'
import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from '../../lib/api-error'

// Minimal fake translator: echoes the key prefixed so assertions stay readable.
const t = ((key: string) => `t:${key}`) as unknown as TFunction

describe('apiErrorMessage', () => {
  it('localizes the UPGRADE_DRAINING error code', () => {
    const err = new Error(UPGRADE_DRAINING_CODE)
    expect(apiErrorMessage(err, t)).toBe('t:session.upgradeDraining')
  })

  it('passes through an unrecognized error message unchanged', () => {
    const err = new Error('Something else broke')
    expect(apiErrorMessage(err, t)).toBe('Something else broke')
  })

  it('stringifies a non-Error value', () => {
    expect(apiErrorMessage('raw string', t)).toBe('raw string')
  })
})

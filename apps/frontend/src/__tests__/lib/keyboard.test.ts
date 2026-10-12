import { describe, expect, it } from 'vitest'
import { isImeComposing } from '@/lib/keyboard'

/** The Enter that confirms an IME candidate must not count as a submit. */
describe('isImeComposing', () => {
  it('is true while the native event reports composition', () => {
    expect(isImeComposing({ keyCode: 13, nativeEvent: { isComposing: true } })).toBe(true)
  })

  it('is true for the Safari post-composition keyCode 229', () => {
    expect(isImeComposing({ keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true)
  })

  it('is false for a plain key press', () => {
    expect(isImeComposing({ keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false)
    expect(isImeComposing({ keyCode: 13, nativeEvent: {} })).toBe(false)
  })
})

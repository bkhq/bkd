/**
 * Regression for use-mobile hook:
 *  - Width-only ≤ 767px → mobile (phone)
 *  - Pointer coarse + ≤ 1024px → mobile (tablet, phone landscape)
 *  - Pointer fine + > 767px → desktop (touchscreen laptop case)
 *
 * Verifies that the upgrade from "width-only" to "width OR (coarse + ≤1024)"
 * actually feeds matchMedia the combined query and returns the matches flag.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsMobile } from '@/hooks/use-mobile'

interface FakeMql {
  matches: boolean
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
  _trigger: () => void
}

function installMatchMedia(matches: boolean): FakeMql {
  let listener: (() => void) | null = null
  const fake: FakeMql = {
    matches,
    addEventListener: (_type, cb) => {
      listener = cb
    },
    removeEventListener: () => {
      listener = null
    },
    _trigger: () => {
      listener?.()
    },
  }
  ;(window as any).matchMedia = vi.fn((query: string) => {
    // Track the query used so callers can assert.
    ;(installMatchMedia as any).lastQuery = query
    return fake
  })
  return fake
}

describe('useIsMobile', () => {
  let originalMM: typeof window.matchMedia

  beforeEach(() => {
    originalMM = window.matchMedia
  })
  afterEach(() => {
    window.matchMedia = originalMM
  })

  it('passes a combined width + pointer media query to matchMedia', () => {
    installMatchMedia(false)
    renderHook(() => useIsMobile())
    const q = (installMatchMedia as any).lastQuery as string
    expect(q).toContain('max-width: 767px')
    expect(q).toContain('pointer: coarse')
    expect(q).toContain('max-width: 1024px')
  })

  it('returns true when matchMedia reports a match', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false when matchMedia does not match', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('updates when the media query changes (e.g. window resize)', () => {
    const mql = installMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    mql.matches = true
    act(() => mql._trigger())
    expect(result.current).toBe(true)
  })

  it('removes its listener on unmount (no leak)', () => {
    const mql = installMatchMedia(false)
    const removeSpy = vi.spyOn(mql, 'removeEventListener')
    const { unmount } = renderHook(() => useIsMobile())
    unmount()
    expect(removeSpy).toHaveBeenCalled()
  })
})

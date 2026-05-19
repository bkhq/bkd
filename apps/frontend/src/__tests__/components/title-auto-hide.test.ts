import type {
  AutoHideState,
  ScrollSample,
} from '@/components/issue-detail/title-auto-hide'
import { describe, expect, it } from 'vitest'
import {
  createAutoHideState,
  DEFAULT_AUTO_HIDE_THRESHOLDS,
  nextAutoHideState,
} from '@/components/issue-detail/title-auto-hide'

// Regression suite for the ChatArea mobile title auto-hide direction fix.
//
// Original bug: the trigger was wired so HIDE only fired on scrollTop-
// increasing scrolls. The chat lands at the bottom of the viewport
// (scrollTop = scrollHeight - clientHeight), so the user can never push
// scrollTop higher — the HIDE branch was unreachable in practice, and the
// title bar stayed pinned no matter how the user dragged the list. Also,
// `pt-[60px]` placeholder under the absolute title meant even a hidden
// title left a 60px void at the top of the message list.
//
// The fix inverts the direction (read-history scroll = HIDE, return-to-
// latest scroll = SHOW) and makes the chat-body padding follow visibility.
// These tests pin the state machine semantics so the direction cannot
// silently flip back.

const FAR_FROM_EDGES: Pick<ScrollSample, 'scrollHeight' | 'clientHeight'> = {
  scrollHeight: 5000,
  clientHeight: 800,
}

// Helper: drive a series of scrollTop samples through the reducer, asserting
// the resulting visible flag after the final sample.
function drive(initial: AutoHideState, steps: number[]): AutoHideState {
  let state = initial
  let prev = steps[0]!
  for (let i = 1; i < steps.length; i++) {
    const top = steps[i]!
    state = nextAutoHideState(state, prev, { ...FAR_FROM_EDGES, scrollTop: top })
    prev = top
  }
  return state
}

describe('title-auto-hide state machine', () => {
  it('starts visible by default', () => {
    expect(createAutoHideState().visible).toBe(true)
  })

  // ── direction semantics ────────────────────────────────────────────────

  it('hides when the user scrolls up (toward older messages) past the threshold', () => {
    // Land somewhere in the middle of the history (scrollTop=2000), then
    // scroll upward in one motion. delta < 0 = reading history.
    const result = drive(createAutoHideState(), [2000, 1958, 1955])
    // Total upward delta = 45 > hide threshold (40)
    expect(result.visible).toBe(false)
  })

  it('shows when the user scrolls down (toward latest) past the threshold from a hidden state', () => {
    const hidden: AutoHideState = { visible: false, upAccum: 0, downAccum: 0 }
    const result = drive(hidden, [2000, 2040, 2065])
    // Total downward delta = 65 > show threshold (60)
    expect(result.visible).toBe(true)
  })

  it('regression: a single up-scroll from the bottom anchor MUST be capable of hiding the title', () => {
    // The original bug: HIDE was wired to scrollTop-increasing scrolls, so
    // a user landing at the bottom (max scrollTop) could never trigger it
    // because there was no further "down" to scroll. After the fix, an
    // upward swipe (scrollTop decreasing) from a mid-list position must
    // hide the title.
    const state = createAutoHideState()
    const next = nextAutoHideState(state, 2000, { ...FAR_FROM_EDGES, scrollTop: 1900 })
    expect(next.visible).toBe(false)
  })

  // ── anchors ────────────────────────────────────────────────────────────

  it('always shows near the top of the list (home anchor)', () => {
    const hidden: AutoHideState = { visible: false, upAccum: 100, downAccum: 0 }
    const next = nextAutoHideState(hidden, 50, { ...FAR_FROM_EDGES, scrollTop: 4 })
    expect(next.visible).toBe(true)
    expect(next.upAccum).toBe(0)
    expect(next.downAccum).toBe(0)
  })

  it('always shows near the bottom of the list (live-conversation anchor)', () => {
    const hidden: AutoHideState = { visible: false, upAccum: 100, downAccum: 0 }
    // scrollHeight=5000, clientHeight=800 → max scrollTop=4200. 30px from
    // the bottom is well within the 80px anchor.
    const next = nextAutoHideState(hidden, 4150, { ...FAR_FROM_EDGES, scrollTop: 4170 })
    expect(next.visible).toBe(true)
  })

  // ── hysteresis ─────────────────────────────────────────────────────────

  it('does not flap on a small jitter below either threshold', () => {
    const state = createAutoHideState()
    // Drift up by 20px (below 40 hide threshold) — stays visible.
    const a = drive(state, [2000, 1985, 1980])
    expect(a.visible).toBe(true)

    // Now the opposite direction jiggles 20px back — still visible, no flap.
    const b = nextAutoHideState(a, 1980, { ...FAR_FROM_EDGES, scrollTop: 2000 })
    expect(b.visible).toBe(true)
  })

  it('resets the opposite accumulator on direction change', () => {
    const state = createAutoHideState()
    // Build a partial up-scroll budget (below hide threshold).
    const partialUp = drive(state, [2000, 1980])
    expect(partialUp.upAccum).toBeGreaterThan(0)

    // Switching direction must clear it so the user can't accidentally
    // hide by alternating tiny up/down nudges.
    const switched = nextAutoHideState(partialUp, 1980, { ...FAR_FROM_EDGES, scrollTop: 1985 })
    expect(switched.upAccum).toBe(0)
    expect(switched.downAccum).toBeGreaterThan(0)
  })

  // ── thresholds ─────────────────────────────────────────────────────────

  it('honors injected thresholds so callers can tune sensitivity', () => {
    const tight = { hide: 5, show: 5, bottomAnchor: 10 }
    const state = createAutoHideState()
    const next = nextAutoHideState(state, 2000, { ...FAR_FROM_EDGES, scrollTop: 1990 }, tight)
    expect(next.visible).toBe(false)
  })

  it('exposes the production thresholds for documentation', () => {
    expect(DEFAULT_AUTO_HIDE_THRESHOLDS).toEqual({ hide: 40, show: 60, bottomAnchor: 80 })
  })
})

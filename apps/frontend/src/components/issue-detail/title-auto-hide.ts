// Pure scroll-direction state machine for ChatArea's mobile title auto-hide.
// Extracted so the decision logic can be regression-tested without a DOM /
// React harness.
//
// Semantics align with mainstream apps (Safari, Twitter, Instagram, etc.):
//   – scroll DOWN (toward bottom/latest, scrollTop ↑) → HIDE  (reading,
//     the bar is just chrome — give it up for more vertical space)
//   – scroll UP   (back toward history,  scrollTop ↓) → SHOW  (navigating,
//     the user wants controls back)
//   – at the top OR near bottom anchor → always SHOW ("home" indicator)
//
// Hysteresis: accumulate per-direction distance and only flip once a
// minimum continuous scroll is reached. Resets the opposite accumulator
// on every direction change so a hesitant nudge doesn't flap the bar.

export interface AutoHideThresholds {
  show: number
  hide: number
  bottomAnchor: number
}

export const DEFAULT_AUTO_HIDE_THRESHOLDS: AutoHideThresholds = {
  show: 16,
  hide: 20,
  bottomAnchor: 80,
}

export interface AutoHideState {
  visible: boolean
  upAccum: number
  downAccum: number
}

export function createAutoHideState(): AutoHideState {
  return { visible: true, upAccum: 0, downAccum: 0 }
}

export interface ScrollSample {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Apply a single scroll sample to the state machine and return the next state.
 * Pure: caller is responsible for tracking `lastTop` between samples and
 * passing the resulting `delta` via the difference in scrollTop.
 */
export function nextAutoHideState(
  state: AutoHideState,
  prevScrollTop: number,
  sample: ScrollSample,
  thresholds: AutoHideThresholds = DEFAULT_AUTO_HIDE_THRESHOLDS,
): AutoHideState {
  const { scrollTop, scrollHeight, clientHeight } = sample
  const delta = scrollTop - prevScrollTop
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight

  if (scrollTop < 8 || distanceFromBottom < thresholds.bottomAnchor) {
    return { visible: true, upAccum: 0, downAccum: 0 }
  }

  // delta < 0: scrollTop ↓ — scrolling UP, user wants controls → SHOW
  if (delta < 0) {
    const upAccum = state.upAccum + -delta
    const visible = upAccum > thresholds.show ? true : state.visible
    return { visible, upAccum, downAccum: 0 }
  }

  // delta > 0: scrollTop ↑ — scrolling DOWN, user is reading → HIDE
  if (delta > 0) {
    const downAccum = state.downAccum + delta
    const visible = downAccum > thresholds.hide ? false : state.visible
    return { visible, upAccum: 0, downAccum }
  }

  return state
}

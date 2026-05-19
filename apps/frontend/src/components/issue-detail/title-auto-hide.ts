// Pure scroll-direction state machine for ChatArea's mobile title auto-hide.
// Extracted so the decision logic can be regression-tested without a DOM /
// React harness.
//
// Semantics: the chat lands at the bottom by default, so "scroll up to read
// history" means scrollTop ↓ (HIDE — give history maximum vertical space),
// and "scroll down toward latest" means scrollTop ↑ (SHOW — re-anchor as
// the reader returns). Always reveal near the top or within BOTTOM_ANCHOR
// pixels of the bottom so the user has a "home" indicator at either end.

export interface AutoHideThresholds {
  hide: number
  show: number
  bottomAnchor: number
}

export const DEFAULT_AUTO_HIDE_THRESHOLDS: AutoHideThresholds = {
  hide: 40,
  show: 60,
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

  if (delta < 0) {
    const upAccum = state.upAccum + -delta
    const visible = upAccum > thresholds.hide ? false : state.visible
    return { visible, upAccum, downAccum: 0 }
  }

  if (delta > 0) {
    const downAccum = state.downAccum + delta
    const visible = downAccum > thresholds.show ? true : state.visible
    return { visible, upAccum: 0, downAccum }
  }

  return state
}

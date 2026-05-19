import * as React from 'react'

/**
 * "Mobile" detection for layout/interaction branching.
 *
 * Returns true when either of the following holds:
 *   1. Viewport width < 768px (typical phone, or a desktop window pulled narrow)
 *   2. Pointer is coarse AND viewport width ≤ 1024px (true tablet / phone landscape)
 *
 * Rationale: width-only misclassifies (a) touchscreen laptops as mobile and
 * (b) phone-landscape as desktop. Adding `(pointer: coarse)` lets us trust the
 * actual input device for the in-between widths while still keeping the cheap
 * width-only path for the unambiguous narrow case.
 *
 * Returns false on the first render (SSR / before-effect) — callers should
 * treat it as desktop-by-default and rely on the post-mount re-render.
 */
const MOBILE_MEDIA_QUERY =
  '(max-width: 767px), (pointer: coarse) and (max-width: 1024px)'

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return isMobile
}

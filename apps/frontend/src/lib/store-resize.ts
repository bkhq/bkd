/**
 * Attach a window resize listener that re-clamps a store's width.
 * Accepts `import.meta.hot` so the listener is properly removed on HMR,
 * preventing listener accumulation across hot reloads.
 */
export function attachResizeClamp(
  getState: () => { width: number, setWidth: (w: number) => void },
  clampWidth: (w: number) => number,
  hot?: { dispose: (cb: () => void) => void },
): void {
  if (typeof window === 'undefined') return

  const handler = () => {
    const s = getState()
    const clamped = clampWidth(s.width)
    if (clamped !== s.width) s.setWidth(clamped)
  }

  window.addEventListener('resize', handler)
  hot?.dispose(() => window.removeEventListener('resize', handler))
}

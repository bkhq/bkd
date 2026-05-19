import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock matchMedia for theme detection in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Polyfill ResizeObserver for libraries (cmdk, base-ui popovers) that use it
// in mount-time effects. jsdom omits this API.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver
}

// Polyfill scrollIntoView (used by cmdk to keep highlighted command in view)
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function noop() {}
}

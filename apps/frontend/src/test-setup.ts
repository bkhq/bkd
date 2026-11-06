import '@testing-library/jest-dom/vitest'

// jsdom has no matchMedia; components using `useIsMobile` call it on mount.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}

// jsdom's Blob has no stream(); shiki's inlined Oniguruma WASM is gunzipped through it.
if (!Blob.prototype.stream) {
  Blob.prototype.stream = function (this: Blob) {
    return new ReadableStream({
      start: async (controller) => {
        controller.enqueue(new Uint8Array(await this.arrayBuffer()))
        controller.close()
      },
    })
  } as Blob['stream']
}

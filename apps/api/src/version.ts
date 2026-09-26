// Injected at compile time via --define; defaults to 'dev' in dev mode
export const VERSION = typeof __BKD_VERSION__ !== 'undefined' ? __BKD_VERSION__ : 'dev'
export const COMMIT = typeof __BKD_COMMIT__ !== 'undefined' ? __BKD_COMMIT__ : 'dev'

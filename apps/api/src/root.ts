import { resolve } from 'node:path'

/**
 * Whether this build was created by `scripts/package.ts`.
 * Injected at bundle time via `--define __BITK_PACKAGE_MODE__=true`.
 * In dev the global is never defined, so we default to false.
 */
declare const __BITK_PACKAGE_MODE__: boolean | undefined
const IS_PACKAGE_MODE: boolean =
  typeof __BITK_PACKAGE_MODE__ !== 'undefined' ? __BITK_PACKAGE_MODE__ : false

/**
 * Installation root — where `data/` lives. It must stay stable across upgrades,
 * so it can never be derived from the app directory (lode installs each version
 * under its own `versions/<version>/` directory).
 *
 * Resolution order:
 *   1. `ROOT_DIR` — explicit, set via lode.toml `[env]` or the environment.
 *   2. `LODE_DIR` — injected by lode; its dir is persistent by contract.
 *   3. Dev: `import.meta.dir` = `<root>/apps/api/src/` → 3 levels up.
 */
export const ROOT_DIR = process.env.ROOT_DIR ?
    resolve(process.env.ROOT_DIR) :
  process.env.LODE_DIR ?
      resolve(process.env.LODE_DIR) :
      resolve(import.meta.dir, '../../..')

/**
 * App package directory (package mode only).
 *
 * In package mode this equals `import.meta.dir` — the version directory holding
 * server.js, public/, migrations/ and version.json. Null when running from source.
 */
export const APP_DIR: string | null = IS_PACKAGE_MODE ? import.meta.dir : null

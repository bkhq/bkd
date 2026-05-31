import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCommand, spawnNode } from '@/engines/spawn'
import { logger } from '@/logger'
import { writeUpgradeToken } from '@/pid-lock'
import { isPathWithinDir, parseVersionFromFileName, VALID_VERSION_RE } from '@/upgrade/utils'
import { APP_BASE, isPackageMode, UPDATES_DIR, VERSION_FILE } from './constants'
import { DRAIN_TIMEOUT_MS, setDraining } from './drain'
import { getDownloadStatus } from './download'

// --- Shutdown registration ---

let registeredShutdownFn: (() => Promise<void>) | null = null

/** Register a callback that performs graceful shutdown (stop server, cancel engines, etc.) */
export function registerShutdownForUpgrade(fn: () => Promise<void>): void {
  registeredShutdownFn = fn
}

// --- Archive extraction (package mode) ---

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  // Extract into a temp directory first, then atomically swap into place.
  // This preserves the existing version directory if extraction fails.
  const tmpDir = `${destDir}.tmp.${Date.now()}`
  mkdirSync(tmpDir, { recursive: true })

  try {
    const { code: exitCode, stderr } = await runCommand(
      ['tar', '-xzf', archivePath, '-C', tmpDir],
      { stderr: 'pipe' },
    )
    if (exitCode !== 0) {
      throw new Error(`Failed to extract archive (exit ${exitCode}): ${stderr}`)
    }

    // Verify the extracted package contains server.js
    const serverPath = resolve(tmpDir, 'server.js')
    if (!existsSync(serverPath)) {
      throw new Error('Invalid app package: missing server.js in extracted contents')
    }

    // Swap: backup old version, rename temp into place, clean up backup
    const backupDir = `${destDir}.backup.${Date.now()}`
    if (existsSync(destDir)) {
      await rename(destDir, backupDir)
    }
    try {
      await rename(tmpDir, destDir)
      // Success: clean up backup
      if (existsSync(backupDir)) {
        await rm(backupDir, { recursive: true }).catch(() => {})
      }
    } catch (swapErr) {
      // Rollback: restore the backup
      if (existsSync(backupDir)) {
        await rename(backupDir, destDir).catch(() => {})
      }
      await rm(tmpDir, { recursive: true }).catch(() => {})
      throw swapErr
    }
  } catch (err) {
    // Clean up temp directory on any failure
    await rm(tmpDir, { recursive: true }).catch(() => {})
    throw err
  }

  logger.info({ archivePath, destDir }, 'upgrade_archive_extracted')
}

// --- Apply & restart ---

let isApplying = false

// Safety timeout must outlast the graceful drain — the shutdown hook can
// block for up to DRAIN_TIMEOUT_MS waiting for in-flight turns to settle.
const APPLY_TIMEOUT_MS = DRAIN_TIMEOUT_MS + 60_000

/**
 * Run the registered graceful shutdown (which drains in-flight turns and
 * releases the port), then spawn `target` as a detached replacement process
 * and exit. Never returns on the success path.
 */
async function shutdownAndRespawn(target: string): Promise<void> {
  // Graceful shutdown: drain in-flight turns, stop server, release the port.
  if (registeredShutdownFn) {
    await registeredShutdownFn()
  } else {
    logger.warn('upgrade_no_shutdown_fn_registered')
  }

  // Write upgrade token so the new process can take over the PID lock.
  writeUpgradeToken()

  // Spawn the replacement as a detached process after the port is released.
  const child = spawnNode([target], {
    env: { ...process.env } as Record<string, string>,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  child.unref?.()

  logger.info('upgrade_shutting_down_for_restart')
  process.exit(0)
}

export async function applyUpgradeAndRestart(): Promise<void> {
  if (isApplying) {
    throw new Error('An upgrade is already being applied')
  }
  isApplying = true

  // Safety timeout: if the upgrade process stalls (e.g. shutdown hangs),
  // reset isApplying so a retry is possible.
  const safetyTimer = setTimeout(() => {
    isApplying = false
    logger.warn('upgrade_apply_timeout_reset')
  }, APPLY_TIMEOUT_MS)
  // Don't keep the process alive just for this timer
  if (typeof safetyTimer === 'object' && 'unref' in safetyTimer) {
    safetyTimer.unref()
  }

  try {
    const status = getDownloadStatus()
    // 'verified' = checksum matched; 'completed' = no checksumUrl was provided.
    // Auto-downloads always include a checksumUrl when available; 'completed'
    // only occurs for manual API calls that omit the optional checksumUrl.
    if (status.status !== 'verified' && status.status !== 'completed') {
      throw new Error('No verified upgrade ready to apply')
    }
    if (!status.filePath || !existsSync(status.filePath)) {
      throw new Error('Upgrade file not found')
    }

    if (isPackageMode) {
      // Package mode: extract to data/app/v{version}/, update current pointer, restart
      const version = parseVersionFromFileName(status.fileName ?? '')
      if (!version) {
        throw new Error(`Cannot determine version from filename: ${status.fileName}`)
      }

      const versionDir = resolve(APP_BASE, `v${version}`)
      logger.info({ archivePath: status.filePath, versionDir }, 'upgrade_extracting_package')
      await extractArchive(status.filePath, versionDir)

      // Activate the new version
      writeFileSync(
        VERSION_FILE,
        JSON.stringify({
          version,
          updatedAt: new Date().toISOString(),
        }),
      )
      logger.info({ version }, 'upgrade_version_activated')

      // Re-exec the launcher binary (process.execPath is the launcher)
      await shutdownAndRespawn(process.execPath)
    } else {
      // Binary mode: spawn the new binary directly
      const upgradeBinary = status.filePath

      // Verify the binary is within the updates directory
      if (!isPathWithinDir(upgradeBinary, UPDATES_DIR)) {
        throw new Error('Upgrade binary path is outside the updates directory')
      }

      logger.info({ from: process.execPath, to: upgradeBinary }, 'upgrade_applying')

      // Spawn the new binary directly as the replacement process
      await shutdownAndRespawn(upgradeBinary)
    }
  } finally {
    clearTimeout(safetyTimer)
    isApplying = false
    // Reset the drain flag so a failed upgrade doesn't leave this still-alive
    // instance permanently rejecting every execution. On the success path
    // process.exit(0) already ran and this finally block never executes;
    // it only matters when a post-drain step (token write / re-spawn) threw.
    setDraining(false)
  }
}

// --- Local package apply (package mode) ---

/**
 * List app package versions already installed under data/app/v{version}/.
 * Only versions with a runnable server.js are returned. Package mode only.
 */
export function listLocalAppVersions(): Array<{ version: string, isCurrent: boolean }> {
  if (!isPackageMode || !existsSync(APP_BASE)) return []

  let current: string | null = null
  if (existsSync(VERSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(VERSION_FILE, 'utf8')) as { version?: unknown }
      if (typeof data.version === 'string') current = data.version
    } catch {
      // Ignore a malformed version.json — just means nothing is marked current.
    }
  }

  const out: Array<{ version: string, isCurrent: boolean }> = []
  for (const entry of readdirSync(APP_BASE, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('v')) continue
    const version = entry.name.slice(1)
    if (!VALID_VERSION_RE.test(version)) continue
    if (!existsSync(resolve(APP_BASE, entry.name, 'server.js'))) continue
    out.push({ version, isCurrent: version === current })
  }
  return out
}

/**
 * Activate an already-installed local app package version and hot-reload
 * through the same graceful-drain path as a downloaded upgrade. Uses runtime
 * module swap (globalThis.hotReloadApp) to avoid process restart — zero 502,
 * engine subprocesses survive. Package mode only.
 */
export async function applyLocalVersion(version: string): Promise<void> {
  if (!isPackageMode) {
    throw new Error('Local version apply is only available in package mode')
  }
  if (!VALID_VERSION_RE.test(version)) {
    throw new Error(`Invalid version: ${version}`)
  }
  if (isApplying) {
    throw new Error('An upgrade is already being applied')
  }
  isApplying = true

  const safetyTimer = setTimeout(() => {
    isApplying = false
    logger.warn('upgrade_apply_timeout_reset')
  }, APPLY_TIMEOUT_MS)
  if (typeof safetyTimer === 'object' && 'unref' in safetyTimer) {
    safetyTimer.unref()
  }

  try {
    const versionDir = resolve(APP_BASE, `v${version}`)
    if (!isPathWithinDir(versionDir, APP_BASE)) {
      throw new Error('Version directory escapes the app directory')
    }
    const serverPath = resolve(versionDir, 'server.js')
    if (!existsSync(serverPath)) {
      throw new Error(`Version ${version} is not installed (missing server.js)`)
    }

    writeFileSync(
      VERSION_FILE,
      JSON.stringify({ version, updatedAt: new Date().toISOString() }),
    )
    logger.info({ version }, 'upgrade_local_version_activated')

    const hotReload = (globalThis as any).hotReloadApp as
      ((versionDir: string) => Promise<void>) | undefined

    if (typeof hotReload === 'function') {
      await hotReload(versionDir)
      logger.info({ version }, 'upgrade_hot_reloaded')
    } else {
      logger.warn('upgrade_hot_reload_unavailable_falling_back_to_restart')
      await shutdownAndRespawn(process.execPath)
    }
  } finally {
    clearTimeout(safetyTimer)
    isApplying = false
    setDraining(false)
  }
}

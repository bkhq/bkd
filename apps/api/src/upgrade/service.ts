/**
 * Upgrade service — a thin façade over the lode supervisor.
 *
 * BKD no longer downloads, verifies or installs anything itself: lode owns the
 * fetch → verify → install → observe → commit/rollback path. This module only
 * reads lode's `state.json` and writes the request fields the app is allowed to
 * set (`target`, `restart_nonce`). See `docs/deployment.md`.
 *
 * Outside lode (dev, or a bare `bun src/index.ts`) every call reports
 * `supervised: false` and the mutating helpers throw.
 */
import type { UpgradeStatus, VersionInfo } from '@bkd/shared'
import { logger } from '@/logger'
import { COMMIT, VERSION } from '@/version'
import { activeVersion, isSupervised, Lode } from './lode-sdk'

const UNSUPERVISED_ERROR = 'Not running under lode — upgrades are managed by the supervisor'

function requireLode(): Lode {
  if (!isSupervised()) {
    throw new Error(UNSUPERVISED_ERROR)
  }
  return Lode.fromEnv()
}

export function getVersionInfo(): VersionInfo {
  return {
    version: VERSION,
    commit: COMMIT,
    supervised: isSupervised(),
    activeVersion: activeVersion() ?? null,
  }
}

export function getUpgradeStatus(): UpgradeStatus {
  const empty: UpgradeStatus = {
    supervised: false,
    status: null,
    current: null,
    lastGood: null,
    available: null,
    hasUpdate: false,
    target: null,
    lastCheck: null,
    lastError: null,
    history: [],
  }

  if (!isSupervised()) return empty

  const state = Lode.fromEnv().read()
  if (!state) return { ...empty, supervised: true }

  const current = state.current ?? activeVersion() ?? null
  const available = state.available ?? null

  return {
    supervised: true,
    status: state.status ?? null,
    current,
    lastGood: state.lastGood ?? null,
    available,
    hasUpdate: !!available && available !== current,
    target: state.target ?? null,
    lastCheck: state.lastCheck ?? null,
    lastError: state.lastError ?? null,
    history: state.history,
  }
}

/** Ask lode to install a version (or `latest`). lode restarts us when it lands. */
export function requestUpgrade(version = 'latest'): void {
  requireLode().requestUpdate(version)
  logger.info({ version }, 'upgrade_requested')
}

/** Ask lode to go back to `version`, or to the recorded last-good version. */
export function requestRollback(version?: string): string {
  const target = requireLode().rollback(version)
  logger.info({ target }, 'upgrade_rollback_requested')
  return target
}

/** Ask lode to stop and relaunch the current version. */
export function requestRestart(): void {
  const nonce = requireLode().reboot()
  logger.info({ nonce }, 'upgrade_restart_requested')
}

/**
 * Tell lode the server can serve traffic. Required under
 * `[supervise].readiness = "state"`, a no-op otherwise.
 */
export function reportReady(): void {
  if (!isSupervised()) return
  try {
    Lode.fromEnv().markReady()
    logger.info({ version: activeVersion() }, 'lode_ready_reported')
  } catch (err) {
    logger.error({ err }, 'lode_ready_report_failed')
  }
}

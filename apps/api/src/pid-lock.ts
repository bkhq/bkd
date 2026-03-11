import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { logger } from './logger'
import { ROOT_DIR } from './root'

// ---------- Constants ----------

const PID_FILE_NAME = 'bkd.pid'

/**
 * Derive the PID lock file path from the same source as the SQLite DB,
 * so the lock always protects the correct database instance.
 *
 * Resolution order:
 *   1. Sibling of DB_PATH (e.g. `data/db/bkd.pid` next to `data/db/bkd.db`)
 *   2. BKD_DATA_DIR/bkd.pid
 *   3. <ROOT_DIR>/data/bkd.pid
 */
function getPidFilePath(): string {
  if (process.env.DB_PATH) {
    const dbDir = dirname(
      process.env.DB_PATH.startsWith('/')
        ? process.env.DB_PATH
        : resolve(ROOT_DIR, process.env.DB_PATH),
    )
    return resolve(dbDir, PID_FILE_NAME)
  }
  const dataDir = process.env.BKD_DATA_DIR
    ? resolve(process.env.BKD_DATA_DIR)
    : resolve(ROOT_DIR, 'data')
  return resolve(dataDir, PID_FILE_NAME)
}

// ---------- Helpers ----------

/**
 * Check whether a process with the given PID is still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 doesn't kill — it just checks existence
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Atomically create a file with O_EXCL (fails if the file already exists).
 * Returns true if the file was created, false if it already existed.
 */
function tryCreateExclusive(filePath: string, content: string): boolean {
  try {
    // O_WRONLY | O_CREAT | O_EXCL — atomic create, fails with EEXIST if file exists
    const fd = openSync(filePath, 'wx')
    try {
      writeSync(fd, content, null, 'utf8')
    } finally {
      closeSync(fd)
    }
    return true
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

// ---------- Public API ----------

/**
 * Acquire a PID lock. If another BKD instance is already running,
 * log an error and exit immediately to prevent dual-instance corruption.
 *
 * Uses O_EXCL for atomic file creation to prevent TOCTOU races where
 * two processes both pass the existence check and write their PIDs.
 *
 * Call this synchronously at the very start of server initialisation,
 * before Bun.serve() or any reconciliation logic.
 */
export function acquirePidLock(): void {
  const pidFile = getPidFilePath()
  const dir = dirname(pidFile)
  mkdirSync(dir, { recursive: true })

  // Fast path: atomically create the lock file. If it succeeds, we own the lock.
  if (tryCreateExclusive(pidFile, String(process.pid))) {
    logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
    return
  }

  // Lock file already exists — check if the owning process is still alive.
  let existingPid = Number.NaN
  try {
    const content = readFileSync(pidFile, 'utf8').trim()
    existingPid = Number.parseInt(content, 10)
  } catch (err) {
    // Corrupt or unreadable PID file — remove and retry
    logger.warn({ err, pidFile }, 'pid_lock_corrupt_removed')
    try {
      unlinkSync(pidFile)
    } catch { /* best effort */ }
    if (tryCreateExclusive(pidFile, String(process.pid))) {
      logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
      return
    }
    // Another process beat us to it
    exitDuplicateInstance(pidFile, Number.NaN)
  }

  if (!Number.isNaN(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
    // Allow takeover when this process was spawned by an upgrade restart.
    // The parent set BKD_UPGRADE_FROM_PID to its own PID before spawning us;
    // if the lock belongs to that parent, it is about to exit — safe to take over.
    const upgradeFromPid = Number.parseInt(process.env.BKD_UPGRADE_FROM_PID ?? '', 10)
    if (existingPid === upgradeFromPid) {
      logger.info(
        { existingPid, pidFile },
        'pid_lock_takeover_from_upgrade_parent',
      )
      // Clear the env var so it doesn't leak to future child processes
      delete process.env.BKD_UPGRADE_FROM_PID
    } else {
      exitDuplicateInstance(pidFile, existingPid)
    }
  } else {
    // PID file exists but the process is dead → stale lock
    logger.warn(
      { stalePid: existingPid, pidFile },
      'pid_lock_stale_removed',
    )
  }

  // Remove stale/takeover lock and write our PID
  try {
    unlinkSync(pidFile)
  } catch { /* best effort */ }
  if (tryCreateExclusive(pidFile, String(process.pid))) {
    logger.info({ pid: process.pid, pidFile }, 'pid_lock_acquired')
    return
  }

  // Extremely unlikely: another process created the file between unlink and open
  exitDuplicateInstance(pidFile, Number.NaN)
}

function exitDuplicateInstance(pidFile: string, existingPid: number): never {
  const pidMsg = existingPid > 0 ? ` (PID ${existingPid})` : ''
  logger.fatal(
    { existingPid: existingPid || undefined, pidFile },
    'pid_lock_failed_another_instance_running',
  )
  console.error(
    `[bkd] Another instance is already running${pidMsg}. `
    + `If this is incorrect, remove the stale lock file: ${pidFile}`,
  )
  process.exit(1)
}

/**
 * Release the PID lock. Only removes the file if it still contains
 * the current process's PID (guards against a race where a new
 * instance has already written its own PID).
 */
export function releasePidLock(): void {
  const pidFile = getPidFilePath()

  try {
    let content: string
    try {
      content = readFileSync(pidFile, 'utf8').trim()
    } catch {
      return // file doesn't exist or unreadable — nothing to release
    }

    const filePid = Number.parseInt(content, 10)

    if (filePid !== process.pid) {
      // Another instance already took over — don't delete their lock
      logger.debug(
        { filePid, currentPid: process.pid },
        'pid_lock_skip_release_not_owner',
      )
      return
    }

    unlinkSync(pidFile)
    logger.info({ pid: process.pid }, 'pid_lock_released')
  } catch (err) {
    // Best-effort removal — don't crash during shutdown
    logger.warn({ err }, 'pid_lock_release_failed')
  }
}

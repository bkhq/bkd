import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeTime, isValid } from 'ulid'
import { localDriver } from '@/fm/drivers/local'
import { purgeExpiredItems } from '@/fm/server/trash'
import { logger } from '@/logger'
import { DATA_DIR } from '@/root'
import { fmDataDir, TRASH_RETENTION_DAYS } from '@/routes/fm'

const MAX_AGE_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000

/** Deletes from the file browser before the file manager: `<trash>/<ulid>/…`. */
export function legacyTrashDir(): string {
  return process.env.BKD_FILES_TRASH_DIR || join(DATA_DIR, 'trash/files')
}

async function purgeLegacy(now: number): Promise<number> {
  const dir = legacyTrashDir()
  let cleaned = 0
  for (const entry of await readdir(dir).catch(() => [])) {
    if (!isValid(entry) || now - decodeTime(entry) <= MAX_AGE_MS) continue
    await rm(join(dir, entry), { recursive: true, force: true }).catch(() => {})
    cleaned++
  }
  return cleaned
}

/** Purge file-manager trash items (every served directory's) older than the retention. */
export async function runTrashCleanup(now = Date.now()): Promise<string> {
  let cleaned = await purgeLegacy(now)
  const base = fmDataDir()
  for (const dir of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory()) continue
    const { purged } = await purgeExpiredItems(localDriver({ root: join(base, dir.name) }), TRASH_RETENTION_DAYS, now)
      .catch(() => ({ purged: 0 }))
    cleaned += purged
  }
  if (cleaned > 0) logger.info({ cleaned }, 'trash_cleanup_done')
  return `cleaned ${cleaned} entries`
}

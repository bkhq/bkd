import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeTime, isValid } from 'ulid'
import { logger } from '@/logger'
import { filesTrashDir } from '@/routes/files'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Purge file-browser deletes (`<trash>/<ulid>/…`) older than 7 days. */
export async function runTrashCleanup(): Promise<string> {
  const dir = filesTrashDir()
  const entries = await readdir(dir).catch(() => [])
  const now = Date.now()
  let cleaned = 0
  for (const entry of entries) {
    if (!isValid(entry) || now - decodeTime(entry) <= MAX_AGE_MS) continue
    await rm(join(dir, entry), { recursive: true, force: true }).catch(() => {})
    cleaned++
  }
  if (cleaned > 0) logger.info({ cleaned }, 'trash_cleanup_done')
  return `cleaned ${cleaned} entries`
}

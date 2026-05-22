import type { AppEventMap } from '@bkd/shared'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '@/db'
import { attachments as attachmentsTable, issues as issuesTable } from '@/db/schema'
import { logger } from '@/logger'
import { UPLOAD_DIR } from '@/uploads'
import type { EngineContext } from '../context'

/** Inline base64 image payload: `data:image/<subtype>;base64,<data>`. */
const DATA_URI_RE = /data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g

const EXT_BY_SUBTYPE: Record<string, string> = {
  'jpeg': '.jpg',
  'jpg': '.jpg',
  'png': '.png',
  'gif': '.gif',
  'webp': '.webp',
  'svg+xml': '.svg',
  'bmp': '.bmp',
  'avif': '.avif',
}

// issueId → projectId; the lock-held pipeline is single-threaded per issue.
const projectIdCache = new Map<string, string>()
function resolveProjectId(issueId: string): string | null {
  const cached = projectIdCache.get(issueId)
  if (cached) return cached
  const row = db
    .select({ projectId: issuesTable.projectId })
    .from(issuesTable)
    .where(eq(issuesTable.id, issueId))
    .get()
  if (row?.projectId) {
    projectIdCache.set(issueId, row.projectId)
    return row.projectId
  }
  return null
}

/**
 * Decode every inline base64 image data-URI in `content` to an attachment file
 * and replace it with a small served URL. Returns the rewritten content
 * (unchanged when there is nothing to extract). Synchronous (fits the pipeline).
 */
export function extractImageDataUris(issueId: string, content: string): string {
  if (!content || !content.includes('data:image/')) return content
  const projectId = resolveProjectId(issueId)
  if (!projectId) return content

  return content.replace(DATA_URI_RE, (match, subtype: string, b64: string) => {
    try {
      const bytes = Buffer.from(b64, 'base64')
      if (bytes.length === 0) return match
      const ext = EXT_BY_SUBTYPE[subtype.toLowerCase()] ?? '.bin'
      const id = ulid()
      const storedName = `${id}${ext}`
      const storagePath = `data/uploads/${storedName}`
      mkdirSync(UPLOAD_DIR, { recursive: true })
      writeFileSync(resolve(UPLOAD_DIR, storedName), bytes)
      db.insert(attachmentsTable)
        .values({
          id,
          issueId,
          logId: null,
          originalName: `image${ext}`,
          storedName,
          mimeType: `image/${subtype}`,
          size: bytes.length,
          storagePath,
        })
        .run()
      return `/api/projects/${projectId}/issues/${issueId}/attachments/${id}`
    } catch (err) {
      logger.warn({ issueId, err }, 'extract_image_failed')
      return match
    }
  })
}

/**
 * Order 5 — extract inline base64 image data-URIs to attachment files.
 *
 * Image-generating models return the image as a markdown data-URI in the
 * assistant text (often >1 MB). Storing that verbatim bloats the log row, every
 * `/logs` response, and each SSE event. This stage decodes each data-URI to a
 * file under `data/uploads/`, records it as an attachment, and rewrites the
 * content to a small served URL — before persistence (order 10) and SSE
 * broadcast (order 100) see the entry.
 */
export function registerExtractImagesStage(
  _ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return
      const rewritten = extractImageDataUris(data.issueId, data.entry.content)
      if (rewritten !== data.entry.content) {
        // Replace entry (do not mutate the original) so persist + SSE see the URL.
        data.entry = { ...data.entry, content: rewritten }
      }
    },
    { order: 5 },
  )
}

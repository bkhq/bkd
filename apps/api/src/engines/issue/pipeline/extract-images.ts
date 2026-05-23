import type { AppEventMap, NormalizedLogEntry } from '@bkd/shared'
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

/** Structured image carried on an entry's metadata by the normalizer. */
interface ImageMetadata {
  mediaType?: string
  base64?: string
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
 * Persist raw image bytes as an attachment file + row and return the served URL.
 * `subtype` is the part after `image/` (e.g. `jpeg`, `png`).
 */
function storeImageBytes(issueId: string, projectId: string, subtype: string, bytes: Buffer): string {
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
      return storeImageBytes(issueId, projectId, subtype, bytes)
    } catch (err) {
      logger.warn({ issueId, err }, 'extract_image_failed')
      return match
    }
  })
}

/**
 * Resolve an entry's image to an attachment, returning a new entry whose content
 * is a small image-markdown URL. Handles two shapes:
 *   1. `metadata.imageData` — a native base64 `image` block (no string round-trip).
 *   2. inline `data:image/...` data-URIs in the text content (legacy/markdown).
 */
export function rewriteEntryImages(issueId: string, entry: NormalizedLogEntry): NormalizedLogEntry {
  const image = (entry.metadata as { imageData?: ImageMetadata } | undefined)?.imageData
  if (image?.base64) {
    const projectId = resolveProjectId(issueId)
    if (!projectId) return entry
    try {
      const bytes = Buffer.from(image.base64, 'base64')
      if (bytes.length === 0) return entry
      const subtype = (image.mediaType ?? 'image/png').split('/')[1] ?? 'png'
      const url = storeImageBytes(issueId, projectId, subtype, bytes)
      const { imageData: _drop, ...metadata } = entry.metadata as Record<string, unknown>
      return { ...entry, content: `![image](${url})`, metadata }
    } catch (err) {
      logger.warn({ issueId, err }, 'extract_image_failed')
      return entry
    }
  }

  const rewritten = extractImageDataUris(issueId, entry.content)
  return rewritten === entry.content ? entry : { ...entry, content: rewritten }
}

/**
 * Order 5 — turn engine-returned images into attachment files.
 *
 * Image-generating models return the image as a native base64 `image` content
 * block (carried here on `metadata.imageData`) or, on some gateways, as a
 * markdown `data:image` URI in the text — either way often >1 MB. Storing that
 * verbatim bloats the log row, every `/logs` response, and each SSE event. This
 * stage writes the bytes to a file under `data/uploads/`, records an attachment,
 * and rewrites the entry to a small served URL — before persistence (order 10)
 * and SSE broadcast (order 100) see the entry.
 */
export function registerExtractImagesStage(
  _ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      if (data.streaming) return
      data.entry = rewriteEntryImages(data.issueId, data.entry)
    },
    { order: 5 },
  )
}

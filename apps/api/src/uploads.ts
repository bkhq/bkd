import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import Busboy from '@fastify/busboy'
import { ulid } from 'ulid'
import { DATA_DIR } from '@/root'

export const UPLOAD_DIR = resolve(DATA_DIR, 'uploads')
// Total size of all files in one upload request
export const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024 // 1 GB
export const MAX_FILES = 10
// Request body cap: the files plus room for the other form fields
export const MAX_REQUEST_BODY_SIZE = MAX_UPLOAD_SIZE + 16 * 1024 * 1024

export interface ReceivedFile {
  id: string
  originalName: string
  storedName: string
  mimeType: string
  size: number
  absolutePath: string
}

export interface SavedFile extends ReceivedFile {
  storagePath: string
}

export interface MultipartUpload<F extends ReceivedFile = ReceivedFile> {
  /** String fields in request order. */
  fields: Array<[string, string]>
  files: F[]
}

export class UploadError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 500) {
    super(message)
    this.name = 'UploadError'
  }
}

/**
 * Parse a multipart request as a stream: each `files` part is written to `dir` while it
 * arrives, so the body is never held in memory. Enforces `MAX_FILES` and the total size
 * limit; on any failure every file written so far is removed and an `UploadError` is thrown.
 */
export async function parseMultipartUpload(
  request: Request,
  opts: { dir: string, storedName: (id: string, originalName: string) => string, maxUploadSize?: number },
): Promise<MultipartUpload> {
  const maxUploadSize = opts.maxUploadSize ?? MAX_UPLOAD_SIZE
  let busboy: InstanceType<typeof Busboy>
  try {
    if (!request.body) throw new Error('missing body')
    busboy = new Busboy({
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      // Keep client file names verbatim so callers can reject path-like names
      preservePath: true,
      limits: { files: MAX_FILES },
    })
  } catch {
    throw new UploadError('Invalid multipart body', 400)
  }
  await mkdir(opts.dir, { recursive: true })

  // Bun's web ReadableStream type does not overlap the node:stream/web one
  const input = Readable.fromWeb(request.body as unknown as NodeReadableStream)
  const fields: Array<[string, string]> = []
  const files: ReceivedFile[] = []
  const fileStreams: Readable[] = []
  const writes: Promise<void>[] = []
  let total = 0
  let failure: UploadError | undefined
  let parsed!: () => void
  const parsing = new Promise<void>((r) => {
    parsed = r
  })
  const fail = (err: UploadError) => {
    failure ??= err
    parsed()
  }

  busboy.on('field', (name, value, _nameTruncated, valueTruncated) => {
    if (valueTruncated) fail(new UploadError(`Field "${name}" is too large`, 400))
    else fields.push([name, value])
  })
  busboy.on('file', (fieldName, stream, filename, _encoding, mimeType) => {
    if (fieldName !== 'files' || failure) {
      stream.resume()
      return
    }
    const id = ulid()
    const storedName = opts.storedName(id, filename)
    const file: ReceivedFile = {
      id,
      originalName: filename,
      storedName,
      mimeType: mimeType || 'application/octet-stream',
      size: 0,
      absolutePath: resolve(opts.dir, storedName),
    }
    files.push(file)
    fileStreams.push(stream)
    const counter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        file.size += chunk.length
        total += chunk.length
        if (total > maxUploadSize) callback(new UploadError('Upload exceeds the size limit', 413))
        else callback(null, chunk)
      },
    })
    writes.push(
      pipeline(stream, counter, createWriteStream(file.absolutePath)).catch((err: unknown) => {
        fail(err instanceof UploadError ? err : new UploadError('Failed to save uploaded files', 500))
      }),
    )
  })
  busboy.on('filesLimit', () => fail(new UploadError(`Too many files (max ${MAX_FILES})`, 400)))
  busboy.on('error', () => fail(new UploadError('Invalid multipart body', 400)))
  busboy.on('finish', () => parsed())
  input.on('error', () => fail(new UploadError('Upload aborted', 400)))
  // Under Bun a client disconnect only emits 'close', without 'error' or 'end'
  input.on('close', () => {
    if (!input.readableEnded) fail(new UploadError('Upload aborted', 400))
  })
  input.pipe(busboy)

  await parsing
  if (failure) {
    // Stop parsing; drain the rest of the body so the error response can still be delivered.
    input.unpipe(busboy)
    input.resume()
    for (const stream of fileStreams) stream.destroy()
  }
  await Promise.all(writes)
  if (failure) {
    await discardFiles(files)
    throw failure
  }
  return { fields, files }
}

/** Stream a multipart request's `files` into the upload directory as attachments. */
export async function receiveAttachments(request: Request): Promise<MultipartUpload<SavedFile>> {
  const { fields, files } = await parseMultipartUpload(request, {
    dir: UPLOAD_DIR,
    storedName: (id, originalName) => `${id}${extname(originalName)}`,
  })
  return { fields, files: files.map(f => ({ ...f, storagePath: `data/uploads/${f.storedName}` })) }
}

/** Best-effort removal of files written by `parseMultipartUpload`. */
export async function discardFiles(files: ReceivedFile[]): Promise<void> {
  await Promise.all(files.map(f => unlink(f.absolutePath).catch(() => {})))
}

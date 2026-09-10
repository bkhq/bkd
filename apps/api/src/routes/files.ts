import { HTTPException } from 'hono/http-exception'
import { FileListingSchema, SavedFileSchema, SaveFileSchema, UploadedFilesSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import * as z from 'zod'
import { createRoute } from '@hono/zod-openapi'
import { readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import bs58 from 'bs58'
import { getAppSetting } from '@/db/helpers'
import { runCommand } from '@/engines/spawn'
import { validateFiles } from '@/uploads'
import type { Context } from 'hono'
import { createOpenAPIRouter } from '@/openapi/hono'

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

const MAX_FILE_SIZE = 1024 * 1024 // 1 MB

/** Check that `target` is inside `root` (or equals it). */
function isInsideRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}/`)
}

/** Heuristic binary check: look for null bytes in the first 8KB. */
function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/** Return a Set of names that git considers ignored in the given directory. */
async function getGitIgnoredNames(dir: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  try {
    const paths = names.map(n => resolve(dir, n))
    const { code: exitCode, stdout } = await runCommand(
      ['git', 'check-ignore', '--', ...paths],
      { cwd: dir },
    )
    // exit code 1 means none matched
    if (exitCode !== 0 && exitCode !== 1) return new Set()
    const ignored = new Set<string>()
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const name = trimmed.split('/').pop()
      if (name) ignored.add(name)
    }
    return ignored
  } catch {
    return new Set()
  }
}

/** Decode base58-encoded root from path param. */
function decodeRoot(encoded: string): string {
  return Buffer.from(bs58.decode(encoded)).toString('utf-8')
}

/** Encode a filesystem path as base58. */
export function encodeRoot(path: string): string {
  return bs58.encode(Buffer.from(path, 'utf-8'))
}

/** Resolve root from :root path param + validate sub-path stays inside it. */
async function resolveRootPath(c: Context, relativePath: string) {
  const rootParam = c.req.param('root')
  if (!rootParam) {
    throw new HTTPException(400, { message: 'Missing root path parameter' })
  }

  let root: string
  try {
    root = resolve(decodeRoot(rootParam))
  } catch {
    throw new HTTPException(400, { message: 'Invalid root encoding' })
  }

  const target = resolve(root, relativePath)

  // SEC-007: Validate root is within workspace
  const workspaceRoot = await getAppSetting('workspace:defaultPath')
  if (workspaceRoot && workspaceRoot !== '/') {
    const resolvedWorkspace = resolve(workspaceRoot)
    if (!isInsideRoot(root, resolvedWorkspace)) {
      throw new HTTPException(403, { message: 'Root is outside the configured workspace' })
    }
  }

  if (!isInsideRoot(target, root)) {
    throw new HTTPException(403, { message: 'Path is outside root directory' })
  }

  return { root, target }
}

/** Extract relative path from the URL after the given marker segment. */
function extractPathAfter(c: Context, marker: string): string {
  const fullPath = new URL(c.req.url).pathname
  const idx = fullPath.indexOf(marker)
  if (idx < 0) return '.'
  const raw = fullPath.slice(idx + marker.length)
  if (!raw) return '.'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// ── /files/:root/show — JSON browse (directory listing + file preview) ──

async function handleShow(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  const { root, target } = resolved

  const hideIgnored = c.req.query('hideIgnored') === 'true'

  try {
    const targetStat = await stat(target)

    // ── File: return content as JSON ──
    if (targetStat.isFile()) {
      const relPath = target === root ? basename(target) : target.slice(root.length + 1)
      const isTruncated = targetStat.size > MAX_FILE_SIZE
      const buf = Buffer.alloc(Math.min(targetStat.size, MAX_FILE_SIZE))

      const file = Bun.file(target)
      const slice = file.slice(0, MAX_FILE_SIZE)
      const arrayBuf = await slice.arrayBuffer()
      Buffer.from(arrayBuf).copy(buf)

      if (isBinaryBuffer(buf)) {
        return c.json({
          success: true as const,
          data: {
            path: relPath,
            type: 'file' as const,
            content: '',
            size: targetStat.size,
            isTruncated: false,
            isBinary: true,
          },
        }, 200)
      }

      return c.json({
        success: true as const,
        data: {
          path: relPath,
          type: 'file' as const,
          content: buf.toString('utf-8'),
          size: targetStat.size,
          isTruncated,
          isBinary: false,
        },
      }, 200)
    }

    // ── Directory: return entry listing ──
    const dirents = await readdir(target, { withFileTypes: true })
    // Include symlinks — use stat() to resolve their target type
    const validNames = dirents
      .filter(d => d.isFile() || d.isDirectory() || d.isSymbolicLink())
      .map(d => d.name)

    const ignoredNames = hideIgnored
      ? await getGitIgnoredNames(target, validNames)
      : new Set<string>()

    const entries: FileEntry[] = []

    for (const d of dirents) {
      if (!d.isFile() && !d.isDirectory() && !d.isSymbolicLink()) continue
      if (d.name === '.git') continue
      if (ignoredNames.has(d.name)) continue

      let size = 0
      let modifiedAt = ''
      let entryType: 'file' | 'directory'
      try {
        // stat() follows symlinks, giving us the target's type and size
        const s = await stat(resolve(target, d.name))
        size = s.size
        modifiedAt = s.mtime.toISOString()
        entryType = s.isDirectory() ? 'directory' : 'file'
      } catch {
        // Broken symlink or inaccessible target — skip
        continue
      }

      entries.push({
        name: d.name,
        type: entryType,
        size,
        modifiedAt,
      })
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    const relPath = target === root ? '.' : target.slice(root.length + 1)

    return c.json({
      success: true as const,
      data: { path: relPath, type: 'directory' as const, entries },
    }, 200)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false as const, error: 'Path not found' }, 404)
    }
    return c.json({ success: false as const, error: 'Failed to read path' }, 500)
  }
}

// ── /files/:root/raw — raw file download ──

async function handleRaw(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  const { target } = resolved

  try {
    const targetStat = await stat(target)

    if (!targetStat.isFile()) {
      return c.json({ success: false as const, error: 'Path is not a file' }, 400)
    }

    const file = Bun.file(target)
    const fileName = basename(target)

    return new Response(file.stream(), {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Length': String(targetStat.size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    })
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false as const, error: 'Path not found' }, 404)
    }
    return c.json({ success: false as const, error: 'Failed to read file' }, 500)
  }
}

// ── /files/:root/delete — delete file or directory ──

async function handleDelete(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  const { target, root } = resolved

  // Prevent deleting the root directory itself
  if (target === root) {
    return c.json({ success: false as const, error: 'Cannot delete root directory' }, 400)
  }

  try {
    const targetStat = await stat(target)
    const isDir = targetStat.isDirectory()
    await rm(target, { recursive: isDir })

    return c.json({ success: true as const, data: { deleted: true } }, 200)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false as const, error: 'Path not found' }, 404)
    }
    return c.json({ success: false as const, error: 'Failed to delete' }, 500)
  }
}

// ── /files/:root/save — save text file content ──

async function handleSave(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  const { target } = resolved

  const parsed = SaveFileSchema.safeParse(await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Invalid JSON' })
  }))
  if (!parsed.success) {
    return c.json({ success: false as const, error: parsed.error.issues.map(i => i.message).join(', ') }, 400)
  }
  const body = parsed.data
  try {
    await writeFile(target, body.content, 'utf-8')

    const fileStat = await stat(target)
    return c.json({
      success: true as const,
      data: { size: fileStat.size, modifiedAt: fileStat.mtime.toISOString() },
    }, 200)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false as const, error: 'Path not found' }, 404)
    }
    return c.json({ success: false as const, error: 'Failed to save file' }, 500)
  }
}

// ── /files/:root/upload — multipart upload into a directory ──

/** Upload names must be a plain basename so they cannot leave the target directory. */
function isValidUploadName(name: string): boolean {
  return name.length > 0
    && name !== '.'
    && name !== '..'
    && name === basename(name)
    && !name.includes('\0')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function handleUpload(c: Context, relativePath: string) {
  const resolved = await resolveRootPath(c, relativePath)
  const { target } = resolved

  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ success: false as const, error: 'Expected multipart/form-data' }, 400)
  }

  let fd: FormData
  try {
    fd = await c.req.formData()
  } catch {
    return c.json({ success: false as const, error: 'Invalid multipart body' }, 400)
  }

  const files = fd.getAll('files').filter((entry): entry is File => entry instanceof File)
  if (files.length === 0) {
    return c.json({ success: false as const, error: 'No files provided' }, 400)
  }

  const validation = validateFiles(files)
  if (!validation.ok) {
    return c.json({ success: false as const, error: validation.error }, 400)
  }

  const invalid = files.find(file => !isValidUploadName(file.name))
  if (invalid) {
    return c.json({ success: false as const, error: `Invalid file name: ${invalid.name}` }, 400)
  }

  const overwriteRaw = fd.get('overwrite')
  const overwrite = overwriteRaw === 'true' || overwriteRaw === '1'

  try {
    const targetStat = await stat(target)
    if (!targetStat.isDirectory()) {
      return c.json({ success: false as const, error: 'Path is not a directory' }, 400)
    }

    if (!overwrite) {
      const existing: string[] = []
      for (const file of files) {
        if (await pathExists(resolve(target, file.name))) existing.push(file.name)
      }
      if (existing.length > 0) {
        return c.json({ success: false as const, error: `Already exists: ${existing.join(', ')}` }, 409)
      }
    }

    const uploaded: Array<{ name: string, size: number }> = []
    for (const file of files) {
      await Bun.write(resolve(target, file.name), file)
      uploaded.push({ name: file.name, size: file.size })
    }

    return c.json({ success: true as const, data: { uploaded } }, 201)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return c.json({ success: false as const, error: 'Path not found' }, 404)
    }
    return c.json({ success: false as const, error: 'Failed to upload' }, 500)
  }
}

const files = createOpenAPIRouter()

// GET /files/:root/show — root directory listing
files.openapi(createRoute({
  method: 'get',
  path: '/{root}/show',
  tags: ['Files'],
  operationId: 'getFilesShow',
  request: { params: z.object({ root: z.string().min(1) }), query: z.object({ hideIgnored: z.enum(['true', 'false']).optional() }) },
  responses: {
    200: successResponse(FileListingSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), c => handleShow(c, '.'))
// GET /files/:root/show/* — browse any sub-path
files.get('/:root/show/*', c => handleShow(c, extractPathAfter(c, '/show/')))

// GET /files/:root/raw/* — download raw file
files.get('/:root/raw/*', c => handleRaw(c, extractPathAfter(c, '/raw/')))

// DELETE /files/:root/delete/* — delete file or directory
files.delete('/:root/delete/*', c => handleDelete(c, extractPathAfter(c, '/delete/')))

// PUT /files/:root/save/* — save text file content
files.put('/:root/save/*', c => handleSave(c, extractPathAfter(c, '/save/')))

// POST /files/:root/upload — upload into the root directory
files.post('/:root/upload', c => handleUpload(c, '.'))
// POST /files/:root/upload/* — upload into a sub-directory
files.post('/:root/upload/*', c => handleUpload(c, extractPathAfter(c, '/upload/')))

files.openAPIRegistry.registerPath(createRoute({
  method: 'get',
  path: '/{root}/show/{path}',
  tags: ['Files'],
  operationId: 'getFilesShowPath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }), query: z.object({ hideIgnored: z.enum(['true', 'false']).optional() }) },
  responses: {
    200: successResponse(FileListingSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'get',
  path: '/{root}/raw/{path}',
  tags: ['Files'],
  operationId: 'getFilesRawPath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }) },
  responses: {
    200: { description: 'File content', content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } },
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'delete',
  path: '/{root}/delete/{path}',
  tags: ['Files'],
  operationId: 'deleteFilesDeletePath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }) },
  responses: {
    200: successResponse(z.object({ deleted: z.boolean() }), 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'put',
  path: '/{root}/save/{path}',
  tags: ['Files'],
  operationId: 'putFilesSavePath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }), body: { required: true, content: { 'application/json': { schema: SaveFileSchema } } } },
  responses: {
    200: successResponse(SavedFileSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'post',
  path: '/{root}/upload',
  tags: ['Files'],
  operationId: 'postFilesUpload',
  request: { params: z.object({ root: z.string().min(1) }), body: { required: true, content: { 'multipart/form-data': { schema: z.object({ files: z.array(z.string().openapi({ type: 'string', format: 'binary' })), overwrite: z.enum(['true', 'false', '1', '0']).optional() }) } } } },
  responses: {
    201: successResponse(UploadedFilesSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'post',
  path: '/{root}/upload/{path}',
  tags: ['Files'],
  operationId: 'postFilesUploadPath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }), body: { required: true, content: { 'multipart/form-data': { schema: z.object({ files: z.array(z.string().openapi({ type: 'string', format: 'binary' })), overwrite: z.enum(['true', 'false', '1', '0']).optional() }) } } } },
  responses: {
    201: successResponse(UploadedFilesSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}))

export default files

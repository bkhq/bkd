import { HTTPException } from 'hono/http-exception'
import { CreateFileSchema, FileListingSchema, FilePathSchema, FileSearchSchema, RenameFileSchema, SavedFileSchema, SaveFileSchema, UploadedFilesSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import * as z from 'zod'
import { createRoute } from '@hono/zod-openapi'
import { cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import bs58 from 'bs58'
import { ulid } from 'ulid'
import { getAppSetting } from '@/db/helpers'
import { runCommand } from '@/engines/spawn'
import { discardFiles, parseMultipartUpload, UploadError } from '@/uploads'
import type { Context } from 'hono'
import { createOpenAPIRouter } from '@/openapi/hono'
import { DATA_DIR } from '@/root'

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

const MAX_FILE_SIZE = 1024 * 1024 // 1 MB
const BINARY_SNIFF_SIZE = 8192

/** Deleted entries land in `<trash>/<ulid>/<name>`; `trash-cleanup` purges them after 7 days. */
export function filesTrashDir(): string {
  return process.env.BKD_FILES_TRASH_DIR || join(DATA_DIR, 'trash/files')
}

/** Check that `target` is inside `root` (or equals it). */
function isInsideRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}/`)
}

/** Heuristic binary check: look for null bytes in the first 8KB. */
function isBinaryBuffer(buf: Uint8Array): boolean {
  return buf.subarray(0, BINARY_SNIFF_SIZE).includes(0)
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
      const file = Bun.file(target)

      // Sniff first: images and PDFs never need the full text read
      if (isBinaryBuffer(new Uint8Array(await file.slice(0, BINARY_SNIFF_SIZE).arrayBuffer()))) {
        return c.json({
          success: true as const,
          data: {
            path: relPath,
            type: 'file' as const,
            content: '',
            size: targetStat.size,
            isTruncated: false,
            isBinary: true,
            modifiedAt: targetStat.mtime.toISOString(),
          },
        }, 200)
      }

      return c.json({
        success: true as const,
        data: {
          path: relPath,
          type: 'file' as const,
          // Streaming decode holds back a multi-byte character cut at the cap
          content: new TextDecoder().decode(await file.slice(0, MAX_FILE_SIZE).arrayBuffer(), { stream: isTruncated }),
          size: targetStat.size,
          isTruncated,
          isBinary: false,
          modifiedAt: targetStat.mtime.toISOString(),
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

    const listed = await Promise.all(validNames
      .filter(name => name !== '.git' && !ignoredNames.has(name))
      .map(async (name): Promise<FileEntry | null> => {
        // stat() follows symlinks, giving us the target's type and size
        const s = await stat(resolve(target, name)).catch(() => null)
        // Broken symlink or inaccessible target — skip
        if (!s) return null
        return { name, type: s.isDirectory() ? 'directory' : 'file', size: s.size, modifiedAt: s.mtime.toISOString() }
      }))
    const entries = listed.filter(entry => entry !== null)

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

/**
 * `?inline=1` on a PDF: served inline and frameable by the app, so the file
 * browser can show it in the browser's own viewer. Other types (HTML, SVG)
 * stay attachments — rendered inline they would run script on this origin.
 * Also read by the CSP `frame-ancestors` callback in `app.ts`.
 */
export function isInlineRawRequest(c: Context): boolean {
  const { pathname, searchParams } = new URL(c.req.url)
  return searchParams.get('inline') === '1'
    && pathname.startsWith('/api/files/')
    && pathname.includes('/raw/')
    && pathname.toLowerCase().endsWith('.pdf')
}

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
    // Revalidate on every use: unchanged files answer 304 instead of a full download
    const lastModified = new Date(Math.floor(targetStat.mtimeMs / 1000) * 1000)
    const since = Date.parse(c.req.header('If-Modified-Since') ?? '')
    if (!Number.isNaN(since) && lastModified.getTime() <= since) {
      return new Response(null, { status: 304, headers: { 'Last-Modified': lastModified.toUTCString(), 'Cache-Control': 'no-cache' } })
    }

    return new Response(file.stream(), {
      headers: {
        'Last-Modified': lastModified.toUTCString(),
        'Cache-Control': 'no-cache',
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Length': String(targetStat.size),
        'Content-Disposition': `${isInlineRawRequest(c) ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`,
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
    // Recoverable: move into the trash rather than removing
    const trashed = join(filesTrashDir(), ulid(), basename(target))
    await mkdir(join(trashed, '..'), { recursive: true })
    try {
      await rename(target, trashed)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      // Different filesystem: copy, then remove
      await cp(target, trashed, { recursive: true, verbatimSymlinks: true })
      await rm(target, { recursive: targetStat.isDirectory(), force: true })
    }

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
    // Refuse to clobber a file changed on disk (e.g. by an agent) since the
    // editor read it. A file deleted meanwhile is a conflict too.
    if (body.expectedModifiedAt !== undefined) {
      const current = await stat(target).catch(() => null)
      if (current?.mtime.toISOString() !== body.expectedModifiedAt) {
        return c.json({ success: false as const, error: 'File changed on disk since it was opened' }, 409)
      }
    }
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

// ── /files/:root/create — new empty file or directory ──

async function handleCreate(c: Context, relativePath: string) {
  const { target, root } = await resolveRootPath(c, relativePath)
  if (target === root) return c.json({ success: false as const, error: 'Path already exists' }, 409)
  const parsed = CreateFileSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ success: false as const, error: 'Invalid request body' }, 400)

  try {
    if (parsed.data.type === 'directory') await mkdir(target)
    else await writeFile(target, '', { flag: 'wx' })
    return c.json({ success: true as const, data: { path: target.slice(root.length + 1) } }, 201)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return c.json({ success: false as const, error: 'Path already exists' }, 409)
    if (code === 'ENOENT' || code === 'ENOTDIR') return c.json({ success: false as const, error: 'Parent directory not found' }, 404)
    return c.json({ success: false as const, error: 'Failed to create' }, 500)
  }
}

// ── /files/:root/rename — move an entry to another root-relative path ──

async function handleRename(c: Context, relativePath: string) {
  const { target, root } = await resolveRootPath(c, relativePath)
  const parsed = RenameFileSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ success: false as const, error: 'Invalid request body' }, 400)
  const destination = resolve(root, parsed.data.to)
  if (!isInsideRoot(destination, root)) {
    return c.json({ success: false as const, error: 'Path is outside root directory' }, 403)
  }
  if (target === root || destination === root) {
    return c.json({ success: false as const, error: 'Cannot rename the root directory' }, 400)
  }
  if (isInsideRoot(destination, target)) {
    return c.json({ success: false as const, error: 'Cannot move a directory into itself' }, 400)
  }

  try {
    await stat(target)
    if (await pathExists(destination)) return c.json({ success: false as const, error: 'Path already exists' }, 409)
    await rename(target, destination)
    return c.json({ success: true as const, data: { path: destination.slice(root.length + 1) } }, 200)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return c.json({ success: false as const, error: 'Path not found' }, 404)
    return c.json({ success: false as const, error: 'Failed to rename' }, 500)
  }
}

// ── /files/:root/search — quick open by file name ──

const SEARCH_LIMIT = 50
const MAX_CANDIDATES = 50_000
const WALK_SKIP = new Set(['.git', 'node_modules'])

/** Files of a git checkout (tracked + untracked, minus ignored), relative to `dir`. */
async function gitFiles(dir: string): Promise<string[] | null> {
  try {
    const { code, stdout } = await runCommand(['git', 'ls-files', '-co', '--exclude-standard', '-z'], { cwd: dir })
    if (code !== 0) return null
    return stdout.split('\0').filter(Boolean).slice(0, MAX_CANDIDATES)
  } catch {
    return null
  }
}

/** Bounded walk for non-git roots; does not follow symlinked directories. */
async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const queue = ['']
  while (queue.length > 0 && out.length < MAX_CANDIDATES) {
    const rel = queue.shift()!
    const dirents = await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])
    for (const d of dirents) {
      const path = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (!WALK_SKIP.has(d.name)) queue.push(path)
      } else {
        out.push(path)
      }
    }
  }
  return out.slice(0, MAX_CANDIDATES)
}

/**
 * Rank a path against a lower-case query: a file-name substring beats a path
 * substring, which beats a scattered (subsequence) match. -1 = no match.
 */
export function scorePath(path: string, query: string): number {
  const lower = path.toLowerCase()
  const name = lower.slice(lower.lastIndexOf('/') + 1)
  const inName = name.indexOf(query)
  if (inName >= 0) return 3000 - (inName === 0 ? 0 : 100) - name.length - lower.length / 100
  if (lower.includes(query)) return 2000 - lower.length
  let at = -1
  let gaps = 0
  for (const ch of query) {
    const next = lower.indexOf(ch, at + 1)
    if (next < 0) return -1
    if (next !== at + 1) gaps++
    at = next
  }
  return 1000 - gaps * 10 - lower.length / 10
}

async function handleSearch(c: Context) {
  const { root } = await resolveRootPath(c, '.')
  const query = (c.req.query('q') ?? '').toLowerCase().replace(/\s+/g, '')
  if (!query) return c.json({ success: true as const, data: { paths: [] } }, 200)

  const candidates = (await gitFiles(root)) ?? (await walkFiles(root))
  const paths = candidates
    .map(path => ({ path, score: scorePath(path, query) }))
    .filter(match => match.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_LIMIT)
    .map(match => match.path)
  return c.json({ success: true as const, data: { paths } }, 200)
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

  try {
    const targetStat = await stat(target)
    if (!targetStat.isDirectory()) {
      return c.json({ success: false as const, error: 'Path is not a directory' }, 400)
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return c.json({ success: false as const, error: 'Path not found' }, 404)
    }
    return c.json({ success: false as const, error: 'Failed to upload' }, 500)
  }

  // Files stream into hidden staging names and are renamed into place once the whole
  // body (including the `overwrite` field, which may follow the files) has been read.
  let upload: Awaited<ReturnType<typeof parseMultipartUpload>>
  try {
    upload = await parseMultipartUpload(c.req.raw, { dir: target, storedName: id => `.bkd-upload-${id}` })
  } catch (err: unknown) {
    if (err instanceof UploadError) return c.json({ success: false as const, error: err.message }, err.status)
    throw err
  }
  const { files: staged } = upload

  const reject = async (error: string, status: 400 | 409) => {
    await discardFiles(staged)
    return c.json({ success: false as const, error }, status)
  }

  if (staged.length === 0) {
    return reject('No files provided', 400)
  }

  const invalid = staged.find(file => !isValidUploadName(file.originalName))
  if (invalid) {
    return reject(`Invalid file name: ${invalid.originalName}`, 400)
  }

  const overwriteRaw = upload.fields.find(([key]) => key === 'overwrite')?.[1]
  const overwrite = overwriteRaw === 'true' || overwriteRaw === '1'

  try {
    if (!overwrite) {
      const existing: string[] = []
      for (const file of staged) {
        if (await pathExists(resolve(target, file.originalName))) existing.push(file.originalName)
      }
      if (existing.length > 0) {
        return reject(`Already exists: ${existing.join(', ')}`, 409)
      }
    }

    const uploaded: Array<{ name: string, size: number }> = []
    for (const file of staged) {
      await rename(file.absolutePath, resolve(target, file.originalName))
      uploaded.push({ name: file.originalName, size: file.size })
    }

    return c.json({ success: true as const, data: { uploaded } }, 201)
  } catch {
    await discardFiles(staged)
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

// POST /files/:root/create/* — new empty file or directory
files.post('/:root/create/*', c => handleCreate(c, extractPathAfter(c, '/create/')))

// POST /files/:root/rename/* — rename or move inside the root
files.post('/:root/rename/*', c => handleRename(c, extractPathAfter(c, '/rename/')))

// GET /files/:root/search?q= — file paths matching a name query
files.get('/:root/search', c => handleSearch(c))

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
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }), query: z.object({ inline: z.enum(['1']).optional().openapi({ description: 'Serve a PDF inline and frameable by the app' }) }) },
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

const fileOpErrors = {
  400: errorResponse('Invalid request'),
  404: errorResponse('Not found'),
  403: errorResponse('Forbidden'),
  409: errorResponse('Conflict'),
  500: errorResponse('Internal error'),
}

files.openAPIRegistry.registerPath(createRoute({
  method: 'post',
  path: '/{root}/create/{path}',
  tags: ['Files'],
  operationId: 'postFilesCreatePath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }), body: { required: true, content: { 'application/json': { schema: CreateFileSchema } } } },
  responses: { 201: successResponse(FilePathSchema, 'Created'), ...fileOpErrors },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'post',
  path: '/{root}/rename/{path}',
  tags: ['Files'],
  operationId: 'postFilesRenamePath',
  request: { params: z.object({ root: z.string().min(1), path: z.string().min(1) }), body: { required: true, content: { 'application/json': { schema: RenameFileSchema } } } },
  responses: { 200: successResponse(FilePathSchema, 'Success'), ...fileOpErrors },
}))

files.openAPIRegistry.registerPath(createRoute({
  method: 'get',
  path: '/{root}/search',
  tags: ['Files'],
  operationId: 'getFilesSearch',
  request: { params: z.object({ root: z.string().min(1) }), query: z.object({ q: z.string().optional() }) },
  responses: { 200: successResponse(FileSearchSchema, 'Success'), ...fileOpErrors },
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

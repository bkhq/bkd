import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ulid } from 'ulid'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { runTrashCleanup } from '@/cron/actions/builtins/trash-cleanup'
import { encodeRoot } from '@/routes/files'
import app from '@/app'
import './setup'

/** File browser operations: reads, revalidation, recoverable delete, create, rename, search. */

const tmpBase = resolve('/tmp', `bkd-files-ops-${process.pid}`)
const ws = resolve(tmpBase, 'workspace')
const trash = resolve(tmpBase, 'trash')
process.env.BKD_FILES_TRASH_DIR = trash

const url = (op: string, path = '') => `http://localhost/api/files/${encodeRoot(ws)}/${op}${path ? `/${path}` : ''}`
const post = (op: string, path: string, body: unknown) =>
  app.request(url(op, path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  await setAppSetting('workspace:defaultPath', tmpBase)
  await cacheDel('app_setting:workspace:defaultPath')
})

beforeEach(() => {
  rmSync(tmpBase, { recursive: true, force: true })
  mkdirSync(ws, { recursive: true })
})

afterAll(async () => {
  rmSync(tmpBase, { recursive: true, force: true })
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('show', () => {
  test('cuts truncated text on a character boundary', async () => {
    // 1 MB cap lands inside the 3-byte "€"
    writeFileSync(resolve(ws, 'big.txt'), `${'a'.repeat(1024 * 1024 - 1)}€tail`)
    const { data } = await (await app.request(url('show', 'big.txt'))).json() as { data: { content: string, isTruncated: boolean } }
    expect(data.isTruncated).toBe(true)
    expect(data.content).toBe('a'.repeat(1024 * 1024 - 1))
  })

  test('reports a binary file without content', async () => {
    writeFileSync(resolve(ws, 'a.bin'), Buffer.from([0x89, 0x50, 0, 1, 2]))
    const { data } = await (await app.request(url('show', 'a.bin'))).json() as { data: { content: string, isBinary: boolean } }
    expect(data).toMatchObject({ isBinary: true, content: '' })
  })
})

describe('raw revalidation', () => {
  test('answers 304 when the file is unchanged', async () => {
    writeFileSync(resolve(ws, 'a.png'), 'x')
    const first = await app.request(url('raw', 'a.png'))
    const lastModified = first.headers.get('Last-Modified')!
    expect(lastModified).toBeTruthy()
    expect(first.headers.get('Cache-Control')).toBe('no-cache')
    const again = await app.request(url('raw', 'a.png'), { headers: { 'If-Modified-Since': lastModified } })
    expect(again.status).toBe(304)
    utimesSync(resolve(ws, 'a.png'), new Date(), new Date(Date.now() + 10_000))
    expect((await app.request(url('raw', 'a.png'), { headers: { 'If-Modified-Since': lastModified } })).status).toBe(200)
  })
})

describe('delete', () => {
  test('moves a directory into the trash', async () => {
    mkdirSync(resolve(ws, 'dir'))
    writeFileSync(resolve(ws, 'dir/a.txt'), 'keep me')
    const res = await app.request(url('delete', 'dir'), { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(existsSync(resolve(ws, 'dir'))).toBe(false)
    const [entry] = readdirSync(trash)
    expect(readFileSync(resolve(trash, entry!, 'dir/a.txt'), 'utf8')).toBe('keep me')
  })

  test('trash cleanup purges entries older than 7 days', async () => {
    const old = ulid(Date.now() - 8 * 24 * 60 * 60 * 1000)
    const fresh = ulid()
    mkdirSync(resolve(trash, old), { recursive: true })
    mkdirSync(resolve(trash, fresh), { recursive: true })
    await runTrashCleanup()
    expect(readdirSync(trash)).toEqual([fresh])
  })
})

describe('create', () => {
  test('creates an empty file and a folder', async () => {
    expect((await post('create', 'a.txt', { type: 'file' })).status).toBe(201)
    expect(readFileSync(resolve(ws, 'a.txt'), 'utf8')).toBe('')
    expect((await post('create', 'sub', { type: 'directory' })).status).toBe(201)
    expect(existsSync(resolve(ws, 'sub'))).toBe(true)
  })

  test('refuses an existing name with 409, leaving it untouched', async () => {
    writeFileSync(resolve(ws, 'a.txt'), 'data')
    expect((await post('create', 'a.txt', { type: 'file' })).status).toBe(409)
    expect(readFileSync(resolve(ws, 'a.txt'), 'utf8')).toBe('data')
  })

  test('refuses a missing parent with 404', async () => {
    expect((await post('create', 'nope/a.txt', { type: 'file' })).status).toBe(404)
  })
})

describe('rename', () => {
  test('moves an entry inside the root', async () => {
    writeFileSync(resolve(ws, 'a.txt'), 'x')
    mkdirSync(resolve(ws, 'sub'))
    const res = await post('rename', 'a.txt', { to: 'sub/b.txt' })
    expect(res.status).toBe(200)
    expect(readFileSync(resolve(ws, 'sub/b.txt'), 'utf8')).toBe('x')
    expect(existsSync(resolve(ws, 'a.txt'))).toBe(false)
  })

  test('refuses an existing target with 409', async () => {
    writeFileSync(resolve(ws, 'a.txt'), 'x')
    writeFileSync(resolve(ws, 'b.txt'), 'y')
    expect((await post('rename', 'a.txt', { to: 'b.txt' })).status).toBe(409)
    expect(readFileSync(resolve(ws, 'b.txt'), 'utf8')).toBe('y')
  })

  test('refuses a target outside the root with 403', async () => {
    writeFileSync(resolve(ws, 'a.txt'), 'x')
    expect((await post('rename', 'a.txt', { to: '../escaped.txt' })).status).toBe(403)
    expect(existsSync(resolve(ws, 'a.txt'))).toBe(true)
  })
})

describe('search', () => {
  test('ranks file-name matches first and skips node_modules', async () => {
    mkdirSync(resolve(ws, 'src/components'), { recursive: true })
    mkdirSync(resolve(ws, 'node_modules/pkg'), { recursive: true })
    writeFileSync(resolve(ws, 'src/components/FileTree.tsx'), '')
    writeFileSync(resolve(ws, 'src/feature-tree.ts'), '')
    writeFileSync(resolve(ws, 'node_modules/pkg/FileTree.js'), '')
    const res = await app.request(`${url('search')}?q=filetree`)
    const { data } = await res.json() as { data: { paths: string[] } }
    expect(data.paths[0]).toBe('src/components/FileTree.tsx')
    expect(data.paths).not.toContain('node_modules/pkg/FileTree.js')
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { encodeRoot } from '@/routes/files'
import app from '@/app'
import './setup'

/**
 * POST /api/files/:root/upload/* — multipart upload into a workspace directory.
 */

const tmpBase = resolve('/tmp', `bkd-upload-test-${process.pid}`)
const workspaceDir = resolve(tmpBase, 'workspace')
const outsideDir = resolve(tmpBase, 'outside')

interface UploadResult {
  success: boolean
  data?: { uploaded: Array<{ name: string, size: number }> }
  error?: string
}

async function upload(root: string, path: string, files: File[], overwrite = false) {
  const fd = new FormData()
  for (const file of files) fd.append('files', file)
  if (overwrite) fd.append('overwrite', 'true')
  const suffix = path ? `/${path}` : ''
  const res = await app.request(`http://localhost/api/files/${encodeRoot(root)}/upload${suffix}`, {
    method: 'POST',
    body: fd,
  })
  return { status: res.status, json: (await res.json()) as UploadResult }
}

beforeAll(async () => {
  mkdirSync(resolve(workspaceDir, 'subdir'), { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(resolve(workspaceDir, 'test.txt'), 'hello workspace')
  writeFileSync(resolve(workspaceDir, 'exists.txt'), 'old')

  await setAppSetting('workspace:defaultPath', workspaceDir)
  await cacheDel('app_setting:workspace:defaultPath')
})

afterAll(async () => {
  rmSync(tmpBase, { recursive: true, force: true })
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('POST /api/files/:root/upload', () => {
  test('writes uploaded files into the root directory', async () => {
    const { status, json } = await upload(workspaceDir, '', [
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
      new File([new Uint8Array([0, 1, 2])], 'blob.bin'),
    ])
    expect(status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data?.uploaded).toEqual([
      { name: 'hello.txt', size: 5 },
      { name: 'blob.bin', size: 3 },
    ])
    expect(readFileSync(resolve(workspaceDir, 'hello.txt'), 'utf-8')).toBe('hello')
    expect(readFileSync(resolve(workspaceDir, 'blob.bin')).length).toBe(3)
  })

  test('writes uploaded files into a sub-directory', async () => {
    const { status } = await upload(workspaceDir, 'subdir', [new File(['nested'], 'nested.txt')])
    expect(status).toBe(201)
    expect(readFileSync(resolve(workspaceDir, 'subdir', 'nested.txt'), 'utf-8')).toBe('nested')
  })

  test('returns 409 and writes nothing when a file already exists', async () => {
    const { status, json } = await upload(workspaceDir, '', [
      new File(['fresh'], 'fresh.txt'),
      new File(['new'], 'exists.txt'),
    ])
    expect(status).toBe(409)
    expect(json.success).toBe(false)
    expect(json.error).toContain('exists.txt')
    expect(readFileSync(resolve(workspaceDir, 'exists.txt'), 'utf-8')).toBe('old')
    expect(existsSync(resolve(workspaceDir, 'fresh.txt'))).toBe(false)
  })

  test('replaces an existing file when overwrite is set', async () => {
    const { status } = await upload(workspaceDir, '', [new File(['new'], 'exists.txt')], true)
    expect(status).toBe(201)
    expect(readFileSync(resolve(workspaceDir, 'exists.txt'), 'utf-8')).toBe('new')
  })

  test('rejects file names that are not a plain basename', async () => {
    for (const name of ['../escape.txt', 'a/b.txt', '..', '.']) {
      const { status, json } = await upload(workspaceDir, 'subdir', [new File(['x'], name)])
      expect(status).toBe(400)
      expect(json.success).toBe(false)
    }
    expect(existsSync(resolve(workspaceDir, 'escape.txt'))).toBe(false)
    expect(existsSync(resolve(workspaceDir, 'subdir', 'b.txt'))).toBe(false)
  })

  test('rejects a target path that is a file', async () => {
    const { status, json } = await upload(workspaceDir, 'test.txt', [new File(['x'], 'x.txt')])
    expect(status).toBe(400)
    expect(json.error).toBe('Path is not a directory')
  })

  test('rejects an upload with no files', async () => {
    const { status } = await upload(workspaceDir, '', [])
    expect(status).toBe(400)
  })

  test('rejects a non-multipart body', async () => {
    const res = await app.request(`http://localhost/api/files/${encodeRoot(workspaceDir)}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [] }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects an oversized file', async () => {
    const { status } = await upload(workspaceDir, '', [
      new File([new Uint8Array(11 * 1024 * 1024)], 'big.bin'),
    ])
    expect(status).toBe(400)
    expect(existsSync(resolve(workspaceDir, 'big.bin'))).toBe(false)
  })

  test('rejects a root outside the workspace', async () => {
    const { status } = await upload(outsideDir, '', [new File(['x'], 'x.txt')])
    expect(status).toBe(403)
    expect(existsSync(resolve(outsideDir, 'x.txt'))).toBe(false)
  })

  test('returns 404 for a missing directory', async () => {
    const { status } = await upload(workspaceDir, 'missing', [new File(['x'], 'x.txt')])
    expect(status).toBe(404)
  })
})

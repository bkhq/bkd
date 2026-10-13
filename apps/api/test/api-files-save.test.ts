import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { encodeRoot } from '@/routes/files'
import app from '@/app'
import './setup'

/**
 * PUT /api/files/:root/save/* with `expectedModifiedAt` — refuses to overwrite
 * a file that changed on disk (e.g. an agent edited it) since it was opened.
 */

const tmpBase = resolve('/tmp', `bkd-save-test-${process.pid}`)
const workspaceDir = resolve(tmpBase, 'workspace')
const filePath = resolve(workspaceDir, 'a.txt')

async function show() {
  const res = await app.request(`http://localhost/api/files/${encodeRoot(workspaceDir)}/show/a.txt`)
  return (await res.json()) as { data: { content: string, modifiedAt: string } }
}

async function save(body: Record<string, unknown>) {
  const res = await app.request(`http://localhost/api/files/${encodeRoot(workspaceDir)}/save/a.txt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as { success: boolean, error?: string } }
}

beforeAll(async () => {
  mkdirSync(workspaceDir, { recursive: true })
  await setAppSetting('workspace:defaultPath', workspaceDir)
  await cacheDel('app_setting:workspace:defaultPath')
})

afterAll(async () => {
  rmSync(tmpBase, { recursive: true, force: true })
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('PUT /api/files/:root/save conflict check', () => {
  test('show reports the file modification time', async () => {
    writeFileSync(filePath, 'v1')
    const { data } = await show()
    expect(data.content).toBe('v1')
    expect(Number.isNaN(Date.parse(data.modifiedAt))).toBe(false)
  })

  test('saves when the file is unchanged since it was read', async () => {
    writeFileSync(filePath, 'v1')
    const { data } = await show()
    const { status } = await save({ content: 'mine', expectedModifiedAt: data.modifiedAt })
    expect(status).toBe(200)
    expect(readFileSync(filePath, 'utf-8')).toBe('mine')
  })

  test('refuses with 409 when the file changed on disk, leaving it untouched', async () => {
    writeFileSync(filePath, 'v1')
    const { data } = await show()
    writeFileSync(filePath, 'agent edit')
    utimesSync(filePath, new Date(), new Date(Date.parse(data.modifiedAt) + 5000))
    const { status, json } = await save({ content: 'mine', expectedModifiedAt: data.modifiedAt })
    expect(status).toBe(409)
    expect(json.success).toBe(false)
    expect(readFileSync(filePath, 'utf-8')).toBe('agent edit')
  })

  test('saves unconditionally without expectedModifiedAt (explicit overwrite)', async () => {
    writeFileSync(filePath, 'agent edit')
    const { status } = await save({ content: 'mine' })
    expect(status).toBe(200)
    expect(readFileSync(filePath, 'utf-8')).toBe('mine')
  })
})

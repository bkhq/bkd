import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { runTrashCleanup } from '@/cron/actions/builtins/trash-cleanup'
import { WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { fmDataDir } from '@/routes/fm'
import { createTestIssue, expectSuccess, post } from './helpers'
import app from '@/app'
import './setup'

/** `/api/fm/:projectId` — the vendored file manager over a project's directories. */

const tmpBase = resolve('/tmp', `bkd-fm-test-${process.pid}`)
const workspace = resolve(tmpBase, 'workspace')
const projectDir = resolve(workspace, 'proj')
const outside = resolve(tmpBase, 'outside')
process.env.BKD_FM_DATA_DIR = resolve(tmpBase, 'fm-data')

let projectId: string
let outsideProjectId: string
let worktree: string
let issueId: string

const fm = (path: string, init?: RequestInit) => app.request(`http://localhost/api/fm/${projectId}${path}`, init)
const json = async <T>(res: Response) => (await res.json()) as T

beforeAll(async () => {
  mkdirSync(resolve(projectDir, 'docs'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(resolve(projectDir, 'readme.txt'), 'hello')
  writeFileSync(resolve(projectDir, 'docs/spec.pdf'), '%PDF-1.4\n%%EOF\n')
  writeFileSync(resolve(outside, 'secret.txt'), 'secret')
  symlinkSync(outside, resolve(projectDir, 'escape'))

  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
  projectId = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'FM', directory: projectDir })).id
  outsideProjectId = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Out', directory: outside })).id
  issueId = expectSuccess(await createTestIssue(projectId, { title: 'Worktree issue' }) as never as { status: number, json: { success: true, data: { id: string } } }).id
  worktree = join(WORKTREE_BASE, projectId, issueId)
  mkdirSync(worktree, { recursive: true })
  writeFileSync(join(worktree, 'wt.txt'), 'worktree file')

  await setAppSetting('workspace:defaultPath', workspace)
  await cacheDel('app_setting:workspace:defaultPath')
})

afterAll(async () => {
  rmSync(tmpBase, { recursive: true, force: true })
  rmSync(join(WORKTREE_BASE, projectId), { recursive: true, force: true })
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('mounts', () => {
  test('lists the project directory and its existing worktrees', async () => {
    const res = await fm('/mounts')
    expect(res.status).toBe(200)
    const body = await json<{ mounts: Array<{ id: string, label: string }> }>(res)
    expect(body.mounts.map(m => m.id)).toEqual(['project', `wt-${issueId}`])
    expect(body.mounts[1]!.label).toContain('Worktree issue')
  })

  test('serves nothing for a project outside the workspace (SEC-007)', async () => {
    const res = await app.request(`http://localhost/api/fm/${outsideProjectId}/mounts`)
    expect((await json<{ mounts: unknown[] }>(res)).mounts).toEqual([])
    const read = await app.request(`http://localhost/api/fm/${outsideProjectId}/m/project/read?path=/secret.txt`)
    expect(read.status).toBe(404)
  })

  test('serves nothing for an unknown project', async () => {
    const res = await app.request('http://localhost/api/fm/nope1234/m/project/stat?path=/')
    expect(res.status).toBe(404)
  })
})

describe('paths', () => {
  test('reads a file of the worktree mount', async () => {
    const res = await fm(`/m/wt-${issueId}/read?path=/wt.txt`)
    expect(await res.text()).toBe('worktree file')
  })

  test('refuses a symlink leaving the project', async () => {
    const res = await fm('/m/project/read?path=/escape/secret.txt')
    expect(res.status).toBe(404)
  })

  test('refuses a path traversal', async () => {
    const res = await fm(`/m/project/read?path=${encodeURIComponent('/../outside/secret.txt')}`)
    expect([400, 404]).toContain(res.status)
  })
})

describe('writes', () => {
  test('accepts raw bytes (not refused as an unsupported media type)', async () => {
    const res = await fm('/m/project/write?path=/new.txt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'raw bytes',
    })
    expect(res.status).toBe(200)
    expect(readFileSync(resolve(projectDir, 'new.txt'), 'utf8')).toBe('raw bytes')
  })
})

describe('trash', () => {
  const remove = (path: string) => fm('/m/project/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'delete', paths: [path] }),
  })

  test('keeps deletes out of the project and restores them', async () => {
    writeFileSync(resolve(projectDir, 'gone.txt'), 'keep me')
    expect((await remove('/gone.txt')).status).toBe(200)
    expect(existsSync(resolve(projectDir, 'gone.txt'))).toBe(false)
    expect(existsSync(resolve(projectDir, '.fm-trash'))).toBe(false)

    const { items } = await json<{ items: Array<{ id: string, path: string }> }>(await fm('/m/project/trash'))
    const item = items.find(i => i.path === '/gone.txt')!
    expect(item).toBeTruthy()

    const restore = await fm('/m/project/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [item.id] }),
    })
    expect(restore.status).toBe(200)
    expect(readFileSync(resolve(projectDir, 'gone.txt'), 'utf8')).toBe('keep me')
  })

  test('trash cleanup purges items past the retention', async () => {
    writeFileSync(resolve(projectDir, 'old.txt'), 'old')
    await remove('/old.txt')
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000
    await runTrashCleanup(later)
    const { items } = await json<{ items: Array<{ path: string }> }>(await fm('/m/project/trash'))
    expect(items.map(i => i.path)).not.toContain('/old.txt')
    expect(readdirSync(fmDataDir()).length).toBe(1)
  })
})

describe('content headers', () => {
  test('a text file keeps the sandboxing CSP and is framable by the app', async () => {
    const res = await fm('/m/project/read?path=/readme.txt')
    const csp = res.headers.get('Content-Security-Policy')!
    expect(csp).toContain('sandbox')
    expect(csp).toContain('frame-ancestors \'self\'')
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('a PDF drops the sandbox so the browser viewer can render it', async () => {
    const res = await fm('/m/project/read?path=/docs/spec.pdf')
    expect(res.headers.get('Content-Type')).toStartWith('application/pdf')
    expect(res.headers.get('Content-Security-Policy')).toBe('frame-ancestors \'self\'')
  })

  test('other API responses keep the app policy', async () => {
    const res = await fm('/mounts')
    expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors \'none\'')
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { encodeRoot } from '@/routes/files'
import app from '@/app'
import './setup'

/**
 * GET /api/files/:root/raw/* — downloads by default; `?inline=1` lets the file
 * browser frame a PDF in the browser's own viewer, and nothing else.
 */

const tmpBase = resolve('/tmp', `bkd-raw-test-${process.pid}`)
const workspaceDir = resolve(tmpBase, 'workspace')

function raw(name: string, query = '') {
  return app.request(`http://localhost/api/files/${encodeRoot(workspaceDir)}/raw/${name}${query}`)
}

beforeAll(async () => {
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(resolve(workspaceDir, 'doc.pdf'), '%PDF-1.4\n%%EOF\n')
  writeFileSync(resolve(workspaceDir, 'page.html'), '<script>alert(1)</script>')
  writeFileSync(resolve(workspaceDir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await setAppSetting('workspace:defaultPath', workspaceDir)
  await cacheDel('app_setting:workspace:defaultPath')
})

afterAll(async () => {
  rmSync(tmpBase, { recursive: true, force: true })
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('GET /api/files/:root/raw', () => {
  test('downloads as an attachment by default', async () => {
    const res = await raw('doc.pdf')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toStartWith('attachment;')
    expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors \'none\'')
    expect(res.headers.get('Content-Security-Policy')).toContain('object-src \'none\'')
  })

  test('serves a PDF inline and frameable by the app with ?inline=1', async () => {
    const res = await raw('doc.pdf', '?inline=1')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toStartWith('application/pdf')
    expect(res.headers.get('Content-Disposition')).toStartWith('inline;')
    expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors \'self\'')
    expect(res.headers.get('Content-Security-Policy')).toContain('object-src \'self\'')
  })

  test.each(['page.html', 'logo.svg'])('keeps %s an attachment even with ?inline=1', async (name) => {
    const res = await raw(name, '?inline=1')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toStartWith('attachment;')
    expect(res.headers.get('Content-Security-Policy')).toContain('frame-ancestors \'none\'')
    expect(res.headers.get('Content-Security-Policy')).toContain('object-src \'none\'')
  })
})

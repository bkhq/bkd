import { describe, expect, it } from 'bun:test'

describe('app-entry', () => {
  it('exports createApp function', async () => {
    const mod = await import('@/app-entry')
    expect(typeof mod.createApp).toBe('function')
  })

  it('createApp produces a working Hono app', async () => {
    const { createApp } = await import('@/app-entry')
    const app = createApp()
    const res = await app.request('http://localhost/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('ok')
  })
})

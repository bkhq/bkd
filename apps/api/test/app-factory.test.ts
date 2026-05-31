import { describe, expect, it } from 'bun:test'
import { createApp } from '@/app'

describe('createApp factory', () => {
  it('returns a Hono app with fetch method', () => {
    const app = createApp()
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe('function')
  })

  it('returns a different instance each call (no singleton leak)', () => {
    const app1 = createApp()
    const app2 = createApp()
    expect(app1).not.toBe(app2)
  })

  it('responds to health check', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('ok')
  })

  it('returns 404 for unknown API route', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/api/nonexistent')
    expect(res.status).toBe(404)
  })

  it('has security headers', async () => {
    const app = createApp()
    const res = await app.request('http://localhost/api/health')
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(res.headers.get('strict-transport-security')).toBeTruthy()
  })
})

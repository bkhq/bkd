import { describe, expect, test } from 'bun:test'
import app from '@/app'
import { SystemInfoSchema, UpgradeStatusSchema, VersionInfoSchema } from '@/openapi/extra-schemas'
import './setup'

const normalize = (path: string) => path.replace(/:[^/]+|\{[^}]+\}/g, '{}').replace(/\/$/, '')

describe('REST documentation', () => {
  test('matches representative runtime responses to their schemas', async () => {
    for (const [path, schema] of [
      ['/api/settings/system-info', SystemInfoSchema],
      ['/api/settings/upgrade/version', VersionInfoSchema],
      ['/api/settings/upgrade/status', UpgradeStatusSchema],
    ] as const) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(schema.safeParse((await res.json()).data).success).toBe(true)
    }
  })

  test('declares each path parameter and uses unique operation IDs', () => {
    const spec = app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 'Test', version: 'test' } })
    const ids: string[] = []
    for (const [path, operations] of Object.entries(spec.paths ?? {})) {
      for (const [method, operation] of Object.entries(operations ?? {})) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
        const definition = operation as { operationId: string, parameters?: { name: string, in: string }[] }
        ids.push(definition.operationId)
        const declared = definition.parameters?.filter(p => p.in === 'path').map(p => p.name) ?? []
        for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) expect(declared).toContain(name)
      }
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
  test('documents every non-streaming business route', () => {
    const spec = app.getOpenAPI31Document({ openapi: '3.1.0', info: { title: 'Test', version: 'test' } })
    const documented = new Set(Object.entries(spec.paths ?? {}).flatMap(([path, operations]) =>
      Object.keys(operations ?? {}).map(method => `${method.toUpperCase()} ${normalize(path)}`)))
    // Wildcard file/log paths and multipart handlers register their contracts separately.
    const exceptions = ['/api/docs', '/api/openapi.json', '/api/runtime', '/api/events', '/api/terminal/ws/']
    const missing = [...new Set(app.routes
      .filter(route => route.method !== 'ALL' && !route.path.includes('*')
        && !exceptions.some(prefix => route.path.startsWith(prefix)))
      .filter(route => !documented.has(`${route.method} ${normalize(route.path)}`))
      .map(route => `${route.method} ${route.path}`))]
    expect(missing).toEqual([])
  })

  test('serves documentation assets from the same origin under CSP', async () => {
    const res = await app.request('/api/docs')
    const html = await res.text()
    const sources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]!)
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source.startsWith('/api/docs/assets/')).toBe(true)
      const asset = await app.request(source)
      expect(asset.status).toBe(200)
      expect((await asset.text()).length).toBeGreaterThan(1000)
    }
    expect(res.headers.get('content-security-policy')).toContain('script-src \'self\'')
  })
})

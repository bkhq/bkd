import { describe, expect, test } from 'bun:test'
import { getCockpitMcpServer } from '@/mcp/cockpit-server'
import './setup'

interface ServerInstance {
  name: string
  version: string
  // sdk-internal McpServer instance — we only check public shape
}

describe('getCockpitMcpServer', () => {
  test('returns a singleton McpServer instance', () => {
    const a = getCockpitMcpServer()
    const b = getCockpitMcpServer()
    expect(a).toBeDefined()
    expect(a).toBe(b)
  })

  test('the singleton config carries the cockpit name + sdk type', () => {
    const srv = getCockpitMcpServer() as unknown as { name: string, type: string, instance: ServerInstance }
    expect(srv.name).toBe('bkd-cockpit')
    expect(srv.type).toBe('sdk')
    expect(srv.instance).toBeDefined()
  })
})

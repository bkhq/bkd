import { describe, expect, test } from 'bun:test'
import { parseRuntimeConfig } from '@/runtime-config'

describe('runtime configuration', () => {
  test('provides validated defaults', () => {
    expect(parseRuntimeConfig({})).toMatchObject({ PORT: 3000, HOST: '0.0.0.0', LOG_LEVEL: 'info', MAX_CONCURRENT_EXECUTIONS: 5 })
  })
  test.each(['abc', '-1', '65536', '1.5', ''])('rejects invalid ports: %s', (PORT) => {
    expect(() => parseRuntimeConfig({ PORT })).toThrow()
  })
  test('validates log levels and concurrency at startup', () => {
    expect(() => parseRuntimeConfig({ LOG_LEVEL: 'verbose' })).toThrow()
    expect(() => parseRuntimeConfig({ MAX_CONCURRENT_EXECUTIONS: '-1' })).toThrow()
    expect(parseRuntimeConfig({ MAX_CONCURRENT_EXECUTIONS: '10', PORT: '3010' }).PORT).toBe(3010)
  })
})

import { describe, expect, test } from 'bun:test'
import { parseMentions } from '@/engines/issue/role-invoke'

describe('parseMentions', () => {
  test('extracts single mention', () => {
    expect(parseMentions('Hello @frontend')).toEqual(['frontend'])
  })

  test('extracts multiple mentions', () => {
    expect(parseMentions('@frontend @backend')).toEqual(['frontend', 'backend'])
  })

  test('deduplicates mentions', () => {
    expect(parseMentions('@frontend @frontend')).toEqual(['frontend'])
  })

  test('returns empty array when no mentions', () => {
    expect(parseMentions('Hello world')).toEqual([])
  })

  test('handles mentions in middle of text', () => {
    expect(parseMentions('帮我设计 @frontend 的登录页')).toEqual(['frontend'])
  })

  test('handles alphanumeric names', () => {
    expect(parseMentions('@frontend-dev @backend_v2')).toEqual(['frontend', 'backend_v2'])
  })

  test('ignores special characters after name', () => {
    expect(parseMentions('@frontend! @backend.')).toEqual(['frontend', 'backend'])
  })
})

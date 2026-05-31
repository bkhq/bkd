import { describe, expect, test } from 'bun:test'
import { bkdQueryIssue, bkdListChildren, bkdLinkIssues, bkdNotifyRoom } from '@/mcp/workspace-tools'
import './setup'

describe('bkdQueryIssue', () => {
  test('returns error for non-existent issue', async () => {
    const result = await bkdQueryIssue({ issueId: 'nonexistent' })
    expect(result.content[0]!.type).toBe('text')
    expect(result.content[0]!.text).toContain('Error')
    expect(result.content[0]!.text).toContain('Issue not found')
  })
})

describe('bkdListChildren', () => {
  test('returns empty array for issue with no children', async () => {
    const result = await bkdListChildren({ parentIssueId: 'nonexistent' })
    expect(result.content[0]!.type).toBe('text')
    const data = JSON.parse(result.content[0]!.text)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })
})

describe('bkdLinkIssues', () => {
  test('does not throw for non-existent issues (silent update)', async () => {
    const result = await bkdLinkIssues({
      childIssueId: 'nonexistent',
      parentIssueId: 'also-fake',
    })
    expect(result.content[0]!.type).toBe('text')
    const data = JSON.parse(result.content[0]!.text)
    expect(data.linked).toBe(true)
  })
})

describe('bkdNotifyRoom', () => {
  test('emits event and returns notified: true', async () => {
    const result = await bkdNotifyRoom({
      roomType: 'command',
      message: 'test notification',
    })
    expect(result.content[0]!.type).toBe('text')
    const data = JSON.parse(result.content[0]!.text)
    expect(data.notified).toBe(true)
  })
})

import { describe, expect, test } from 'bun:test'
import { api, expectError, expectSuccess, get } from './helpers'
import './setup'

interface Template {
  id: string
  name: string
  source: 'builtin' | 'user'
  titlePattern?: string
  promptPrefix?: string
  defaultStatusId?: string
  defaultTags?: string[]
}

describe('GET /api/issue-templates', () => {
  test('returns at least the built-in templates', async () => {
    const res = await get<Template[]>('/api/issue-templates')
    const data = expectSuccess(res)
    const ids = data.map(t => t.id)
    expect(ids).toContain('bug-fix')
    expect(ids).toContain('refactor')
    expect(ids).toContain('add-tests')
    for (const t of data) {
      expect(t.name).toBeTruthy()
    }
  })
})

describe('PUT /api/issue-templates', () => {
  test('persists user templates and returns them in subsequent GETs', async () => {
    const customs = [
      {
        id: 'my-custom',
        name: 'My Custom Template',
        promptPrefix: 'Investigate and propose a plan: ',
        defaultStatusId: 'todo',
        defaultTags: ['research'],
      },
    ]
    const put = await api<{ count: number }>('PUT', '/api/issue-templates', { templates: customs })
    const putData = expectSuccess(put)
    expect(putData.count).toBe(1)

    const list = expectSuccess(await get<Template[]>('/api/issue-templates'))
    const mine = list.find(t => t.id === 'my-custom')
    expect(mine).toBeDefined()
    expect(mine!.source).toBe('user')
    expect(mine!.name).toBe('My Custom Template')

    // built-ins still present
    expect(list.some(t => t.id === 'bug-fix')).toBe(true)
  })

  test('rejects malformed templates', async () => {
    const bad = [
      { id: '', name: 'no id' },
    ]
    const res = await api('PUT', '/api/issue-templates', { templates: bad })
    expectError(res, 400)
  })

  test('rejects too many user templates', async () => {
    const tooMany = Array.from({ length: 60 }, (_, i) => ({
      id: `t-${i}`,
      name: `T ${i}`,
    }))
    const res = await api('PUT', '/api/issue-templates', { templates: tooMany })
    expectError(res, 400)
  })
})

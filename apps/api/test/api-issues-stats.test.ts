import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectSuccess, get, patch, post } from './helpers'
import './setup'

interface ProjectStats {
  projectId: string
  projectName: string
  projectAlias: string
  counts: { todo: number, working: number, review: number, done: number }
  total: number
}

let alphaId: string
let betaId: string

beforeAll(async () => {
  alphaId = await createTestProject('Stats Alpha')
  betaId = await createTestProject('Stats Beta')

  // alpha: 2 todo, 1 working, 1 done
  for (let i = 0; i < 2; i++) {
    const r = await post<{ id: string }>(`/api/projects/${alphaId}/issues`, {
      title: `a-todo-${i}`,
      statusId: 'todo',
    })
    expectSuccess(r)
  }
  {
    const r = await post<{ id: string }>(`/api/projects/${alphaId}/issues`, {
      title: 'a-todo-promote',
      statusId: 'todo',
    })
    const { id } = expectSuccess(r)
    const up = await patch<{ id: string }>(`/api/projects/${alphaId}/issues/${id}`, {
      statusId: 'working',
    })
    expectSuccess(up)
  }
  {
    const r = await post<{ id: string }>(`/api/projects/${alphaId}/issues`, {
      title: 'a-done',
      statusId: 'todo',
    })
    const { id } = expectSuccess(r)
    const up = await patch<{ id: string }>(`/api/projects/${alphaId}/issues/${id}`, {
      statusId: 'done',
    })
    expectSuccess(up)
  }

  // beta: 1 review
  {
    const r = await post<{ id: string }>(`/api/projects/${betaId}/issues`, {
      title: 'b-review',
      statusId: 'todo',
    })
    const { id } = expectSuccess(r)
    const up = await patch<{ id: string }>(`/api/projects/${betaId}/issues/${id}`, {
      statusId: 'review',
    })
    expectSuccess(up)
  }
})

describe('GET /api/issues/stats', () => {
  test('returns per-project status counts', async () => {
    const res = await get<ProjectStats[]>('/api/issues/stats')
    const data = expectSuccess(res)

    const alpha = data.find(p => p.projectId === alphaId)
    const beta = data.find(p => p.projectId === betaId)

    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()

    expect(alpha!.counts.todo).toBe(2)
    expect(alpha!.counts.working).toBe(1)
    expect(alpha!.counts.review).toBe(0)
    expect(alpha!.counts.done).toBe(1)
    expect(alpha!.total).toBe(4)
    expect(alpha!.projectName).toBe('Stats Alpha')
    expect(alpha!.projectAlias).toBeTruthy()

    expect(beta!.counts.todo).toBe(0)
    expect(beta!.counts.working).toBe(0)
    expect(beta!.counts.review).toBe(1)
    expect(beta!.counts.done).toBe(0)
    expect(beta!.total).toBe(1)
  })

  test('includes projects with zero issues', async () => {
    const emptyId = await createTestProject('Stats Empty')
    const res = await get<ProjectStats[]>('/api/issues/stats')
    const data = expectSuccess(res)
    const empty = data.find(p => p.projectId === emptyId)
    expect(empty).toBeDefined()
    expect(empty!.total).toBe(0)
    expect(empty!.counts).toEqual({ todo: 0, working: 0, review: 0, done: 0 })
  })
})

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import app from '@/app'
import { UPLOAD_DIR } from '@/uploads'
import { createTestIssue, createTestProject, expectSuccess } from './helpers'
import './setup'

/**
 * Multipart issue create / follow-up requests that are rejected after the body has been
 * streamed must not leave their files in the upload directory.
 */

let projectId: string

function storedUploads(): Set<string> {
  return new Set(existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : [])
}

function withFile(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.append(key, value)
  fd.append('files', new File(['attachment body'], 'note.txt', { type: 'text/plain' }))
  return fd
}

async function expectNoNewUploads(send: () => Response | Promise<Response>, status: number) {
  const before = storedUploads()
  const res = await send()
  expect(res.status).toBe(status)
  expect([...storedUploads()].filter(name => !before.has(name))).toEqual([])
}

beforeAll(async () => {
  projectId = await createTestProject('Upload rejections')
})

describe('multipart rejections discard uploaded files', () => {
  test('issue create with an invalid field', async () => {
    await expectNoNewUploads(() => app.request(`/api/projects/${projectId}/issues`, {
      method: 'POST',
      body: withFile({ title: 'Bad', statusId: 'todo', useWorktree: 'tru' }),
    }), 400)
  })

  test('issue create with an unknown engine', async () => {
    await expectNoNewUploads(() => app.request(`/api/projects/${projectId}/issues`, {
      method: 'POST',
      body: withFile({ title: 'Bad engine', statusId: 'todo', engineType: 'no-such-engine' }),
    }), 400)
  })

  test('follow-up to a missing issue', async () => {
    await expectNoNewUploads(() => app.request(`/api/projects/${projectId}/issues/missing1/follow-up`, {
      method: 'POST',
      body: withFile({ prompt: 'hello' }),
    }), 404)
  })

  test('follow-up with an invalid field', async () => {
    const issue = expectSuccess(await createTestIssue(projectId, { engineType: 'codex' }))
    await expectNoNewUploads(() => app.request(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
      method: 'POST',
      body: withFile({ prompt: 'hello', busyAction: 'explode' }),
    }), 400)
  })
})

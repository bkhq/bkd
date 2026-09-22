import type { Issue } from '@bkd/shared'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import app from '@/app'
import { db } from '@/db'
import { attachments } from '@/db/schema'
import { createTestIssue, createTestProject, expectSuccess } from './helpers'
import './setup'

/** Where uploads landed before UPLOAD_DIR moved off the process cwd. */
const LEGACY_UPLOAD_DIR = resolve(process.cwd(), 'data/uploads')

const legacyFiles: string[] = []

let projectId: string
let issueId: string

function insertAttachment(opts: { storedName: string, storagePath: string }): string {
  const id = ulid()
  db.insert(attachments)
    .values({
      id,
      issueId,
      logId: null,
      originalName: 'legacy.txt',
      storedName: opts.storedName,
      mimeType: 'text/plain',
      size: 6,
      storagePath: opts.storagePath,
    })
    .run()
  return id
}

beforeAll(async () => {
  projectId = await createTestProject('Attachment Project')
  const issue = expectSuccess(
    await createTestIssue(projectId, { title: 'Attachment Issue', statusId: 'todo' }),
  ) as { id: string }
  issueId = issue.id
})

afterAll(() => {
  for (const path of legacyFiles) rmSync(path, { force: true })
})

describe('attachment serving', () => {
  test('serves a file uploaded with the issue', async () => {
    const fd = new FormData()
    fd.append('title', 'Issue With File')
    fd.append('statusId', 'todo')
    fd.append('files', new File(['hello!'], 'note.txt', { type: 'text/plain' }))

    const created = await app.request(`http://localhost/api/projects/${projectId}/issues`, {
      method: 'POST',
      body: fd,
    })
    expect(created.status).toBe(201)
    const json = (await created.json()) as { data: Issue }

    const [row] = db.select().from(attachments).where(eq(attachments.issueId, json.data.id)).all()
    expect(row).toBeDefined()

    const res = await app.request(
      `http://localhost/api/projects/${projectId}/issues/${json.data.id}/attachments/${row!.id}`,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello!')
  })

  test('still serves attachments written to the pre-DATA_DIR location', async () => {
    const storedName = `${ulid()}.txt`
    const legacyPath = resolve(LEGACY_UPLOAD_DIR, storedName)
    mkdirSync(LEGACY_UPLOAD_DIR, { recursive: true })
    writeFileSync(legacyPath, 'legacy')
    legacyFiles.push(legacyPath)

    const attachmentId = insertAttachment({
      storedName,
      storagePath: `data/uploads/${storedName}`,
    })

    const res = await app.request(
      `http://localhost/api/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}`,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('legacy')
  })

  test('rejects a stored name that escapes the upload directory (SEC-025)', async () => {
    const attachmentId = insertAttachment({
      storedName: '../../../etc/passwd',
      storagePath: 'data/uploads/../../../etc/passwd',
    })

    const res = await app.request(
      `http://localhost/api/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}`,
    )
    expect(res.status).toBe(400)
  })

  test('reports a missing file instead of falling back outside the upload directories', async () => {
    const attachmentId = insertAttachment({
      storedName: `${ulid()}.txt`,
      storagePath: `data/uploads/${ulid()}.txt`,
    })

    const res = await app.request(
      `http://localhost/api/projects/${projectId}/issues/${issueId}/attachments/${attachmentId}`,
    )
    expect(res.status).toBe(404)
  })
})

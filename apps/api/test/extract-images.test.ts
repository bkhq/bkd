import type { NormalizedLogEntry } from '@bkd/shared'
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { attachments as attachmentsTable } from '@/db/schema'
import { extractImageDataUris, rewriteEntryImages } from '@/engines/issue/pipeline/extract-images'
import { createTestIssue, createTestProject, expectSuccess } from './helpers'
import './setup'

// 1x1 transparent PNG.
const PNG_B64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('extractImageDataUris (ENG-018)', () => {
  test('extracts a base64 image to an attachment file and rewrites the content', async () => {
    const projectId = await createTestProject('Image Extract Project')
    const issue = expectSuccess(
      await createTestIssue(projectId, { title: 'x', statusId: 'todo' }),
    ) as { id: string }

    const content = `caption\n\n![image](data:image/png;base64,${PNG_B64})`
    const out = extractImageDataUris(issue.id, content)

    // data-URI replaced with a served attachment URL
    expect(out).not.toContain('data:image')
    expect(out).toMatch(
      new RegExp(`!\\[image\\]\\(/api/projects/${projectId}/issues/${issue.id}/attachments/[0-9A-Z]+\\)`),
    )
    expect(out.length).toBeLessThan(content.length)

    // attachment row + file created
    const rows = db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.issueId, issue.id))
      .all()
    expect(rows.length).toBe(1)
    expect(rows[0]!.mimeType).toBe('image/png')
    expect(rows[0]!.size).toBeGreaterThan(0)
    expect(existsSync(resolve(process.cwd(), rows[0]!.storagePath))).toBe(true)
  })

  test('leaves content without data-URIs unchanged', async () => {
    const projectId = await createTestProject('No Image Project')
    const issue = expectSuccess(
      await createTestIssue(projectId, { title: 'x', statusId: 'todo' }),
    ) as { id: string }
    const content = 'just text, no images'
    expect(extractImageDataUris(issue.id, content)).toBe(content)
  })

  test('rewrites metadata.imageData to an attachment URL and drops the base64 (ENG-019)', async () => {
    const projectId = await createTestProject('Image Block Project')
    const issue = expectSuccess(
      await createTestIssue(projectId, { title: 'x', statusId: 'todo' }),
    ) as { id: string }

    const entry: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: '',
      metadata: { messageId: 'm1', imageData: { mediaType: 'image/png', base64: PNG_B64 } },
    }
    const out = rewriteEntryImages(issue.id, entry)

    // content becomes a served attachment URL; base64 is gone from metadata
    expect(out.content).toMatch(
      new RegExp(`^!\\[image\\]\\(/api/projects/${projectId}/issues/${issue.id}/attachments/[0-9A-Z]+\\)$`),
    )
    expect(out.metadata?.imageData).toBeUndefined()
    expect(out.metadata?.messageId).toBe('m1')

    const rows = db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.issueId, issue.id))
      .all()
    expect(rows.length).toBe(1)
    expect(rows[0]!.mimeType).toBe('image/png')
    expect(existsSync(resolve(process.cwd(), rows[0]!.storagePath))).toBe(true)
  })
})

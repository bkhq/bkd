import { describe, expect, test } from 'bun:test'
import { post } from './helpers'
import './setup'

describe('POST /api/projects/:projectId/issues/:issueId/restart', () => {
  test('accepts engineType in body when issue does not exist (validation passes before 404)', async () => {
    const result = await post('/api/projects/nonexistent/issues/nonexistent/restart', {
      engineType: 'claude-code',
    })
    // Body schema accepts engineType, so this should not be a 400.
    // It will 404 because the project doesn't exist.
    expect(result.status).toBe(404)
  })

  test('accepts empty body (engineType is optional)', async () => {
    const result = await post('/api/projects/nonexistent/issues/nonexistent/restart', {})
    expect(result.status).toBe(404)
  })

  test('accepts body with only engineType field', async () => {
    const result = await post('/api/projects/nonexistent/issues/nonexistent/restart', {
      engineType: 'codex',
    })
    expect(result.status).toBe(404)
  })

  test('ignores unknown fields in body (body is optional per schema)', async () => {
    const result = await post('/api/projects/nonexistent/issues/nonexistent/restart', {
      engineType: 'claude-code',
      bogus: true,
    })
    // The body schema is required: false, so unknown fields are silently accepted.
    // The 404 comes from the project not existing, confirming core routing works.
    expect(result.status).toBe(404)
  })
})

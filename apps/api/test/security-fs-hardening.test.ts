import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { cacheDel } from '@/cache'
import { post } from './helpers'
import './setup'

/**
 * Security hardening tests for file system and git routes.
 * Covers SEC-007, SEC-030.
 * Note: symlink verification (SEC-008, SEC-009) was removed to support
 * worktrees and other legitimate symlink use cases.
 */

const tmpBase = resolve('/tmp', `bkd-sec-test-${process.pid}`)
const workspaceDir = resolve(tmpBase, 'workspace')
const outsideDir = resolve(tmpBase, 'outside')

beforeAll(async () => {
  // Create test directory structure
  mkdirSync(resolve(workspaceDir, 'subdir'), { recursive: true })
  mkdirSync(outsideDir, { recursive: true })

  // Create test files
  writeFileSync(resolve(workspaceDir, 'test.txt'), 'hello workspace')
  writeFileSync(resolve(workspaceDir, 'subdir', 'nested.txt'), 'nested file')
  writeFileSync(resolve(outsideDir, 'secret.txt'), 'secret data')

  // Create symlink inside workspace pointing outside (simulating worktree)
  symlinkSync(outsideDir, resolve(workspaceDir, 'linked-dir'))

  // Set workspace root
  await setAppSetting('workspace:defaultPath', workspaceDir)
  await cacheDel('app_setting:workspace:defaultPath')
})

afterAll(async () => {
  // Clean up
  rmSync(tmpBase, { recursive: true, force: true })

  // Reset workspace setting
  await setAppSetting('workspace:defaultPath', '/')
  await cacheDel('app_setting:workspace:defaultPath')
})

describe('SEC-030: /api/git/detect-remote workspace validation', () => {
  test('rejects directory outside workspace', async () => {
    const result = await post<unknown>('/api/git/detect-remote', {
      directory: outsideDir,
    })
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })

  test('allows directory within workspace', async () => {
    const result = await post<unknown>('/api/git/detect-remote', {
      directory: workspaceDir,
    })
    // Should not be 403 — may be 400 (not a git repo) or 404, but not access denied
    expect(result.status).not.toBe(403)
  })

  test('rejects directory with path traversal', async () => {
    const traversal = resolve(workspaceDir, '..', 'outside')
    const result = await post<unknown>('/api/git/detect-remote', {
      directory: traversal,
    })
    expect(result.status).toBe(403)
    expect(result.json.success).toBe(false)
  })
})

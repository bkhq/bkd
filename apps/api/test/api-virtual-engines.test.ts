import type { VirtualEngine } from '@bkd/shared'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { resolveExecEnvVars } from '@/engines/issue/utils/helpers'
import { clearVirtualModelCache, fetchVirtualEngineModels } from '@/engines/virtual-engines'
import { api, createTestProject, expectError, expectSuccess, get, patch, post } from './helpers'
/**
 * Virtual engines API + resolution tests.
 */
import './setup'

const GLM: VirtualEngine = {
  id: 'glm-test',
  name: 'GLM (test)',
  baseEngine: 'claude-code',
  baseUrl: 'https://example.com/api',
  authToken: 'sk-test-token',
  model: 'glm-4.6',
  envVars: { EXTRA_ONE: 'x' },
}

function putVirtual(engines: VirtualEngine[]) {
  return api<VirtualEngine[]>('PUT', '/api/engines/virtual', { engines })
}

// Reset to empty so this file does not leak virtual engines into other suites.
afterAll(async () => {
  await putVirtual([])
})

describe('PUT/GET /api/engines/virtual', () => {
  test('saves and lists a virtual engine', async () => {
    const saved = expectSuccess(await putVirtual([GLM]))
    expect(saved).toHaveLength(1)
    expect(saved[0]!.id).toBe('glm-test')
    expect(saved[0]!.baseEngine).toBe('claude-code')

    const listed = expectSuccess(await get<VirtualEngine[]>('/api/engines/virtual'))
    const found = listed.find(v => v.id === 'glm-test')
    expect(found?.baseUrl).toBe('https://example.com/api')
    expect(found?.authToken).toBe('sk-test-token')
    expect(found?.envVars.EXTRA_ONE).toBe('x')
  })

  test('rejects an invalid baseUrl', async () => {
    const result = await putVirtual([{ ...GLM, baseUrl: 'not-a-url' }])
    expectError(result, 400)
  })

  test('rejects an id that collides with a built-in engine', async () => {
    const result = await putVirtual([{ ...GLM, id: 'claude-code' }])
    expectError(result, 400)
  })

  test('rejects an invalid env var name', async () => {
    const result = await putVirtual([{ ...GLM, envVars: { '1BAD': 'x' } }])
    expectError(result, 400)
  })
})

describe('virtual engines in discovery + profiles', () => {
  test('appear in /available and /profiles', async () => {
    await putVirtual([GLM])

    const discovery = expectSuccess(
      await get<{ engines: Array<{ engineType: string }>, models: Record<string, unknown[]> }>(
        '/api/engines/available',
      ),
    )
    expect(discovery.engines.some(e => e.engineType === 'glm-test')).toBe(true)
    expect(Array.isArray(discovery.models['glm-test'])).toBe(true)

    const profiles = expectSuccess(
      await get<Array<{ engineType: string, name: string }>>('/api/engines/profiles'),
    )
    expect(profiles.find(p => p.engineType === 'glm-test')?.name).toBe('GLM (test)')
  }, 30_000)
})

describe('create issue with a virtual engine', () => {
  test('persists engineType=base + engineProfileId + preset model', async () => {
    await putVirtual([GLM])
    const projectId = await createTestProject('Virtual Engine Project')

    const result = await post<{
      engineType: string
      engineProfileId: string | null
      model: string | null
    }>(`/api/projects/${projectId}/issues`, {
      title: 'Uses virtual engine',
      statusId: 'todo',
      engineType: 'glm-test',
    })
    const issue = expectSuccess(result)
    expect(issue.engineType).toBe('claude-code')
    expect(issue.engineProfileId).toBe('glm-test')
    expect(issue.model).toBe('glm-4.6')
  })

  test('explicit model overrides the preset model', async () => {
    await putVirtual([GLM])
    const projectId = await createTestProject('Virtual Engine Project 2')

    const issue = expectSuccess(
      await post<{ engineProfileId: string | null, model: string | null }>(
        `/api/projects/${projectId}/issues`,
        { title: 'x', statusId: 'todo', engineType: 'glm-test', model: 'glm-4.5' },
      ),
    )
    expect(issue.engineProfileId).toBe('glm-test')
    expect(issue.model).toBe('glm-4.5')
  })

  test('rejects an explicit unknown engine id (no silent fallback)', async () => {
    await putVirtual([GLM])
    const projectId = await createTestProject('Unknown Engine Project')
    const res = await post(`/api/projects/${projectId}/issues`, {
      title: 'x',
      statusId: 'todo',
      engineType: 'totally-unknown',
    })
    expectError(res, 400)
  })

  test('falls back to the virtual engine saved default model when the profile has none', async () => {
    await putVirtual([
      { id: 'glm-nomodel', name: 'GLM', baseEngine: 'claude-code', baseUrl: 'https://example.com', envVars: {} },
    ])
    await patch('/api/engines/glm-nomodel/settings', { defaultModel: 'glm-4.6' })
    const projectId = await createTestProject('Virtual Default Model Project')
    const issue = expectSuccess(
      await post<{ engineProfileId: string | null, model: string | null }>(
        `/api/projects/${projectId}/issues`,
        { title: 'x', statusId: 'todo', engineType: 'glm-nomodel' },
      ),
    )
    expect(issue.engineProfileId).toBe('glm-nomodel')
    expect(issue.model).toBe('glm-4.6')
  })
})

describe('resolveExecEnvVars', () => {
  test('profile env overrides project env; passthrough when no profile', async () => {
    await putVirtual([GLM])

    const merged = await resolveExecEnvVars('glm-test', {
      ANTHROPIC_BASE_URL: 'https://project-override.example',
      PROJECT_ONLY: 'keep',
    })
    // Dedicated baseUrl/authToken fields win over project env.
    expect(merged?.ANTHROPIC_BASE_URL).toBe('https://example.com/api')
    expect(merged?.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-token')
    expect(merged?.EXTRA_ONE).toBe('x')
    expect(merged?.PROJECT_ONLY).toBe('keep')

    const passthrough = await resolveExecEnvVars(null, { A: '1' })
    expect(passthrough).toEqual({ A: '1' })
  })
})

describe('engine settings routes accept a virtual id (ENG-015)', () => {
  test('default-engine, per-engine model + hidden-models accept a virtual id', async () => {
    await putVirtual([GLM])

    const def = await patch<{ defaultEngine: string }>('/api/engines/default-engine', {
      defaultEngine: 'glm-test',
    })
    expect(def.status).toBe(200)
    expect(expectSuccess(def).defaultEngine).toBe('glm-test')

    const model = await patch<{ engineType: string }>('/api/engines/glm-test/settings', {
      defaultModel: 'gemini-3.5-flash',
    })
    expect(model.status).toBe(200)

    const hidden = await patch<{ engineType: string }>('/api/engines/glm-test/hidden-models', {
      hiddenModels: ['x'],
    })
    expect(hidden.status).toBe(200)

    // Reset default engine so it does not leak into other suites.
    await patch('/api/engines/default-engine', { defaultEngine: 'claude-code' })
  })

  test('rejects an unknown engine id', async () => {
    const result = await patch('/api/engines/default-engine', { defaultEngine: 'nope-not-real' })
    expectError(result, 400)
  })
})

describe('fetchVirtualEngineModels', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    clearVirtualModelCache()
  })

  test('maps OpenAI /v1/models response to EngineModel[] and hits {base}/v1/models', async () => {
    clearVirtualModelCache()
    let calledUrl = ''
    let authHeader = ''
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = String(url)
      authHeader = String((init?.headers as Record<string, string>)?.authorization ?? '')
      return new Response(JSON.stringify({ data: [{ id: 'gemini-3.5-flash' }, { id: 'glm-4.6' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const models = await fetchVirtualEngineModels({
      id: 'glm-test',
      name: 'GLM',
      baseEngine: 'claude-code',
      baseUrl: 'https://aigw.example.com',
      authToken: 'sk-x',
      model: 'glm-4.6',
      envVars: {},
    })

    expect(calledUrl).toBe('https://aigw.example.com/v1/models')
    expect(authHeader).toBe('Bearer sk-x')
    expect(models.map(m => m.id)).toEqual(['gemini-3.5-flash', 'glm-4.6'])
    expect(models.find(m => m.id === 'glm-4.6')?.isDefault).toBe(true)
  })

  test('returns [] on a non-OK response', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    const models = await fetchVirtualEngineModels({
      id: 'down',
      name: 'D',
      baseEngine: 'claude-code',
      baseUrl: 'https://x.example',
      envVars: {},
    })
    expect(models).toEqual([])
  })
})

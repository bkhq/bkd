import { existsSync } from 'node:fs'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { listClaudeSessions, readClaudeSession } from '@/sessions/claude'
import { deleteLocalSession } from '@/sessions'
import { listCodexSessions, readCodexSession } from '@/sessions/codex'
import './setup'

/** Local session scanning (SES-001). Fixtures mirror the real on-disk layouts. */

const ROOT = join(tmpdir(), `bkd-sessions-test-${process.pid}`)
const CLAUDE_ROOT = join(ROOT, 'claude', 'projects')
const CODEX_ROOT = join(ROOT, 'codex', 'sessions')

const CLAUDE_SESSION = '11111111-2222-3333-4444-555555555555'
const CODEX_SESSION = '019ff851-9fd7-7151-bbc8-bec2e774ed10'
const CODEX_SUBAGENT_SESSION = '019ff851-0000-7151-bbc8-bec2e774ed11'

function jsonl(lines: unknown[]): string {
  return `${lines.map(l => JSON.stringify(l)).join('\n')}\n`
}

beforeAll(async () => {
  const projectDir = join(CLAUDE_ROOT, '-app-demo')
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, `${CLAUDE_SESSION}.jsonl`),
    jsonl([
      { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-01T10:00:00.000Z', content: 'queued prompt' },
      {
        type: 'user',
        message: { role: 'user', content: 'add a login page' },
        cwd: '/app/demo',
        sessionId: CLAUDE_SESSION,
        version: '2.1.231',
        gitBranch: 'main',
        timestamp: '2026-08-01T10:00:01.000Z',
      },
      {
        type: 'assistant',
        message: { id: 'msg_1', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'on it' }] },
        timestamp: '2026-08-01T10:00:02.000Z',
      },
      {
        type: 'assistant',
        isSidechain: true,
        agentId: 'agent-1',
        message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'subagent noise' }] },
        timestamp: '2026-08-01T10:00:03.000Z',
      },
    ]),
  )
  // Sidecar directory written by newer CLIs — must not be listed as a session
  await mkdir(join(projectDir, CLAUDE_SESSION, 'subagents'), { recursive: true })
  await writeFile(join(projectDir, CLAUDE_SESSION, 'subagents', 'agent-abc.jsonl'), jsonl([{ type: 'user' }]))
  await writeFile(join(projectDir, 'notes.txt'), 'not a session')

  const codexDay = join(CODEX_ROOT, '2026', '08', '12')
  await mkdir(codexDay, { recursive: true })
  await writeFile(
    join(codexDay, `rollout-2026-08-12T23-32-06-${CODEX_SESSION}.jsonl`),
    jsonl([
      {
        timestamp: '2026-08-12T23:32:07.789Z',
        type: 'session_meta',
        payload: {
          id: CODEX_SESSION,
          timestamp: '2026-08-12T23:32:06.744Z',
          cwd: '/app/demo',
          originator: 'codex_cli_rs',
          cli_version: '0.104.0',
        },
      },
      { timestamp: '2026-08-12T23:32:10.111Z', type: 'turn_context', payload: { model: 'gpt-5.3-codex', cwd: '/app/demo' } },
      { timestamp: '2026-08-12T23:32:10.128Z', type: 'event_msg', payload: { type: 'user_message', message: 'say OK' } },
      { timestamp: '2026-08-12T23:32:11.000Z', type: 'event_msg', payload: { type: 'agent_reasoning', text: 'thinking about it' } },
      { timestamp: '2026-08-12T23:32:12.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls -la"}', call_id: 'call_1' } },
      { timestamp: '2026-08-12T23:32:13.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: 'total 0' } },
      { timestamp: '2026-08-12T23:32:14.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'OK' } },
      { timestamp: '2026-08-12T23:32:15.000Z', type: 'event_msg', payload: { type: 'token_count', info: {} } },
    ]),
  )
  await writeFile(
    join(codexDay, `rollout-2026-08-12T23-40-00-${CODEX_SUBAGENT_SESSION}.jsonl`),
    jsonl([
      {
        timestamp: '2026-08-12T23:40:00.000Z',
        type: 'session_meta',
        payload: {
          id: CODEX_SUBAGENT_SESSION,
          cwd: '/app/demo',
          cli_version: '0.104.0',
          source: { subagent: { thread_spawn: { parent_thread_id: CODEX_SESSION, depth: 1 } } },
        },
      },
      { timestamp: '2026-08-12T23:40:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'inner work' } },
    ]),
  )

  const old = new Date('2026-08-01T10:05:00.000Z')
  await utimes(join(projectDir, `${CLAUDE_SESSION}.jsonl`), old, old)
})

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
})

describe('listClaudeSessions', () => {
  test('reports session metadata from the transcript head', async () => {
    const sessions = await listClaudeSessions(CLAUDE_ROOT)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      engine: 'claude-code',
      sessionId: CLAUDE_SESSION,
      cwd: '/app/demo',
      title: 'add a login page',
      gitBranch: 'main',
      cliVersion: '2.1.231',
      model: 'claude-opus-5',
      startedAt: '2026-08-01T10:00:00.000Z',
    })
    expect(sessions[0]!.sizeBytes).toBeGreaterThan(0)
  })

  test('ignores subagent sidecar directories and non-transcript files', async () => {
    const sessions = await listClaudeSessions(CLAUDE_ROOT)
    expect(sessions.map(s => s.sessionId)).toEqual([CLAUDE_SESSION])
  })

  test('returns an empty list for a missing root', async () => {
    expect(await listClaudeSessions(join(ROOT, 'nope'))).toEqual([])
  })
})

describe('readClaudeSession', () => {
  test('normalizes the transcript and drops sidechain turns', async () => {
    const [session] = await listClaudeSessions(CLAUDE_ROOT)
    const entries = await readClaudeSession(session!)
    const contents = entries.map(e => e.content)
    expect(contents).toContain('add a login page')
    expect(contents).toContain('on it')
    expect(contents).not.toContain('subagent noise')
  })
})

describe('listCodexSessions', () => {
  test('reports rollout metadata and excludes subagent threads', async () => {
    const sessions = await listCodexSessions(CODEX_ROOT)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      engine: 'codex',
      sessionId: CODEX_SESSION,
      cwd: '/app/demo',
      title: 'say OK',
      cliVersion: '0.104.0',
      model: 'gpt-5.3-codex',
      startedAt: '2026-08-12T23:32:06.744Z',
    })
  })
})

describe('readCodexSession', () => {
  test('maps rollout payloads to normalized entries', async () => {
    const [session] = await listCodexSessions(CODEX_ROOT)
    const entries = await readCodexSession(session!)

    expect(entries.map(e => e.entryType)).toEqual([
      'user-message',
      'thinking',
      'tool-use',
      'tool-use',
      'assistant-message',
    ])
    expect(entries[0]!.content).toBe('say OK')
    expect(entries[2]!.toolDetail?.toolName).toBe('exec_command')
    expect(entries[3]!.metadata?.isResult).toBe(true)
    expect(entries[3]!.metadata?.toolCallId).toBe('call_1')
    expect(entries[4]!.content).toBe('OK')
  })
})

describe('deleteLocalSession', () => {
  test('removes a claude transcript together with its sidecar directory', async () => {
    const projectDir = join(CLAUDE_ROOT, '-app-doomed')
    const doomed = '77777777-2222-3333-4444-555555555555'
    await mkdir(join(projectDir, doomed, 'subagents'), { recursive: true })
    await writeFile(join(projectDir, `${doomed}.jsonl`), jsonl([
      { type: 'user', message: { role: 'user' }, cwd: '/app/doomed', sessionId: doomed, timestamp: '2026-08-01T10:00:00.000Z' },
    ]))
    await writeFile(join(projectDir, doomed, 'subagents', 'agent-x.jsonl'), jsonl([{ type: 'user' }]))

    const [session] = (await listClaudeSessions(CLAUDE_ROOT)).filter(s => s.sessionId === doomed)
    expect(session).toBeDefined()

    await deleteLocalSession(session!)

    expect(existsSync(join(projectDir, `${doomed}.jsonl`))).toBe(false)
    expect(existsSync(join(projectDir, doomed))).toBe(false)
  })

  test('removes a codex rollout', async () => {
    const [session] = await listCodexSessions(CODEX_ROOT)
    expect(existsSync(session!.path)).toBe(true)

    await deleteLocalSession(session!)

    expect(existsSync(session!.path)).toBe(false)
    expect(await listCodexSessions(CODEX_ROOT)).toHaveLength(0)
  })
})

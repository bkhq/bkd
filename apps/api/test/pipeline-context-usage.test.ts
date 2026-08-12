import type { AppEventMap } from '@bkd/shared'
import { beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { issues, projects } from '@/db/schema'
import type { EngineContext } from '@/engines/issue/context'
import { registerContextUsageStage } from '@/engines/issue/pipeline/context-usage'
import { appEvents } from '@/events'

/** Minimal EngineContext stub: only `pm.get(executionId).meta.engineType` is used. */
function fakeCtx(engineType: string): EngineContext {
  return {
    pm: { get: () => ({ meta: { engineType } }) },
  } as unknown as EngineContext
}

/** Register the stage with a pass-through `on` and return the captured callback. */
function stageCallback(ctx: EngineContext): (data: AppEventMap['log']) => void {
  let cb: ((data: AppEventMap['log']) => void) | undefined
  registerContextUsageStage(ctx, (callback) => {
    cb = callback
    return () => {}
  })
  return cb!
}

function logEvent(
  issueId: string,
  entry: AppEventMap['log']['entry'],
  streaming = false,
): AppEventMap['log'] {
  return { issueId, executionId: 'exec-1', entry, streaming }
}

let issueId: string

beforeAll(() => {
  db.insert(projects)
    .values({ id: 'ctxproj1', name: 'Ctx Test', alias: 'ctx-test', path: '/tmp' })
    .onConflictDoNothing()
    .run()
  issueId = 'ctxiss01'
  db.insert(issues)
    .values({
      id: issueId,
      projectId: 'ctxproj1',
      statusId: 'todo',
      issueNumber: 9901,
      title: 'ctx test',
    })
    .onConflictDoNothing()
    .run()
})

function readRow() {
  return db
    .select({ contextTokens: issues.contextTokens, contextWindow: issues.contextWindow })
    .from(issues)
    .where(sql`${issues.id} = ${issueId}`)
    .get()!
}

describe('registerContextUsageStage', () => {
  test('token-usage entry updates contextTokens and emits context-usage', () => {
    const cb = stageCallback(fakeCtx('claude-code'))

    let emitted: AppEventMap['context-usage'] | undefined
    const unsub = appEvents.on('context-usage', (data) => {
      emitted = data
    })

    cb(
      logEvent(issueId, {
        entryType: 'token-usage',
        content: '',
        metadata: { inputTokens: 123000, outputTokens: 500 },
      }),
    )

    unsub()
    expect(readRow().contextTokens).toBe(123500)
    expect(emitted?.issueId).toBe(issueId)
    expect(emitted?.contextTokens).toBe(123500)
  })

  test('result entry with modelUsage updates contextWindow', () => {
    const cb = stageCallback(fakeCtx('claude-code'))

    cb(
      logEvent(issueId, {
        entryType: 'system-message',
        content: '',
        metadata: {
          turnCompleted: true,
          modelUsage: { 'claude-opus-5': { contextWindow: 200000 } },
        },
      }),
    )

    expect(readRow().contextWindow).toBe(200000)
  })

  test('non-claude executions are ignored', () => {
    const cb = stageCallback(fakeCtx('codex'))
    const before = readRow()

    cb(
      logEvent(issueId, {
        entryType: 'token-usage',
        content: '',
        metadata: { inputTokens: 999999, outputTokens: 1 },
      }),
    )

    expect(readRow()).toEqual(before)
  })
})

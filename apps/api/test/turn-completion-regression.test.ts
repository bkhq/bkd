import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { getPendingMessages } from '@/db/pending-messages'
import {
  issueLogs as issueLogsTable,
  issues as issuesTable,
  projects as projectsTable,
} from '@/db/schema'
import type { EngineContext } from '@/engines/issue/context'
import { flushSettleTimer, handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { ExecutionStore } from '@/engines/issue/store/execution-store'
import type { ManagedProcess } from '@/engines/issue/types'
import { waitFor } from './helpers'
import './setup'

let projectId: string

beforeAll(async () => {
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: 'Turn Completion Regression Project',
      alias: `turn-completion-reg-${Date.now()}`,
    })
    .returning()
  projectId = p!.id
})

async function createWorkingIssue(title: string) {
  const [maxRow] = await db.select({ maxNum: db.$count(issuesTable) }).from(issuesTable)
  const issueNumber = (maxRow?.maxNum ?? 0) + 1

  const [issue] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'working',
      issueNumber,
      title,
      engineType: 'codex',
      sessionStatus: 'running',
      prompt: title,
      externalSessionId: `sess-${Date.now()}`,
      model: 'auto',
    })
    .returning()
  return issue!
}

async function insertPendingMessage(issueId: string, content: string) {
  await db.insert(issueLogsTable).values({
    issueId,
    turnIndex: 0,
    entryIndex: 0,
    entryType: 'user-message',
    content,
    metadata: JSON.stringify({ type: 'pending' }),
    visible: 1,
  })
}

describe('turn completion — ACP engine delayed auto-settle', () => {
  test(
    'ACP process alive → turn completion auto-settles after 5s grace',
    async () => {
      const issue = await createWorkingIssue(`turn-completion-alive-${Date.now()}`)
      const executionId = `exec-alive-${Date.now()}`
      const managed: ManagedProcess = {
        executionId,
        issueId: issue.id,
        engineType: 'acp',
        process: {
          subprocess: { exited: new Promise(() => {}) }, // never exits
        } as any,
        state: 'running',
        startedAt: new Date(),
        logs: new ExecutionStore(executionId),
        retryCount: 0,
        turnInFlight: true,
        queueCancelRequested: false,
        logicalFailure: false,
        turnSettled: false,
        slashCommands: [],
        agents: [],
        plugins: [],
        keepAlive: false,
        lastActivityAt: new Date(),
        pendingInputs: [],
      }

      const ctx: EngineContext = {
        pm: {
          get: (id: string) => (id === executionId ? ({ meta: managed } as any) : undefined),
          getActive: () => [],
        } as any,
        issueOpLocks: new Map(),
        entryCounters: new Map(),
        turnIndexes: new Map(),
        userMessageIds: new Map(),
        lastErrors: new Map(),
        lockDepth: new Map(),
        followUpIssue: null,
      }

      handleTurnCompleted(ctx, issue.id, executionId)

      // Wait for the async Phase 1 (updateIssueSession) to complete
      await waitFor(async () => {
        const [row] = await db
          .select({ sessionStatus: issuesTable.sessionStatus })
          .from(issuesTable)
          .where(eq(issuesTable.id, issue.id))
        return row?.sessionStatus === 'completed'
      }, 3000)

      // Within the 5-second grace period, issue should still be working
      await new Promise(r => setTimeout(r, 1000))

      const [rowMid] = await db
        .select({ statusId: issuesTable.statusId, sessionStatus: issuesTable.sessionStatus })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))

      expect(rowMid?.statusId).toBe('working')
      expect(rowMid?.sessionStatus).toBe('completed')

      // After the 5-second grace period, issue should auto-settle to review
      await new Promise(r => setTimeout(r, 4500))

      const [rowFinal] = await db
        .select({ statusId: issuesTable.statusId, sessionStatus: issuesTable.sessionStatus })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))

      expect(rowFinal?.statusId).toBe('review')
      expect(rowFinal?.sessionStatus).toBe('completed')
    },
    { timeout: 15000 },
  )

  test(
    'process exit → flushSettleTimer settles immediately',
    async () => {
      const issue = await createWorkingIssue(`turn-completion-exit-${Date.now()}`)
      // Pre-set sessionStatus so settleAfterGrace guard passes
      await db
        .update(issuesTable)
        .set({ sessionStatus: 'completed' })
        .where(eq(issuesTable.id, issue.id))

      const executionId = `exec-exit-${Date.now()}`
      const managed: ManagedProcess = {
        executionId,
        issueId: issue.id,
        engineType: 'acp',
        process: {
          subprocess: { exited: Promise.resolve(0) },
        } as any,
        state: 'running',
        startedAt: new Date(),
        logs: new ExecutionStore(executionId),
        retryCount: 0,
        turnInFlight: true,
        queueCancelRequested: false,
        logicalFailure: false,
        turnSettled: true,
        slashCommands: [],
        agents: [],
        plugins: [],
        keepAlive: false,
        lastActivityAt: new Date(),
        pendingInputs: [],
      }

      const ctx: EngineContext = {
        pm: {
          get: (id: string) => (id === executionId ? ({ meta: managed } as any) : undefined),
          getActive: () => [],
        } as any,
        issueOpLocks: new Map(),
        entryCounters: new Map(),
        turnIndexes: new Map(),
        userMessageIds: new Map(),
        lastErrors: new Map(),
        lockDepth: new Map(),
        followUpIssue: null,
      }

      flushSettleTimer(ctx, managed)

      await waitFor(async () => {
        const [row] = await db
          .select({ statusId: issuesTable.statusId })
          .from(issuesTable)
          .where(eq(issuesTable.id, issue.id))
        return row?.statusId === 'review'
      }, 3000)

      const [row] = await db
        .select({ statusId: issuesTable.statusId })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))
      expect(row?.statusId).toBe('review')
    },
    { timeout: 10000 },
  )
})

describe('turn completion pending-flush regression', () => {
  test('failed auto-flush keeps DB pending rows for retry', async () => {
    const issue = await createWorkingIssue(`turn-completion-pending-${Date.now()}`)
    const pendingPrompt = `pending-msg-${Date.now()}`
    await insertPendingMessage(issue.id, pendingPrompt)

    const executionId = `exec-${Date.now()}`
    const managed: ManagedProcess = {
      executionId,
      issueId: issue.id,
      engineType: 'codex',
      process: {
        subprocess: { exited: Promise.resolve(0) },
      } as any,
      state: 'running',
      startedAt: new Date(),
      logs: new ExecutionStore(executionId),
      retryCount: 0,
      turnInFlight: true,
      queueCancelRequested: false,
      logicalFailure: false,
      turnSettled: false,
      slashCommands: [],
      agents: [],
      plugins: [],
      keepAlive: false,
      lastActivityAt: new Date(),
      pendingInputs: [],
    }

    const ctx: EngineContext = {
      pm: {
        get: (id: string) => (id === executionId ? ({ meta: managed } as any) : undefined),
        getActive: () => [],
      } as any,
      issueOpLocks: new Map(),
      entryCounters: new Map(),
      turnIndexes: new Map(),
      userMessageIds: new Map(),
      lastErrors: new Map(),
      lockDepth: new Map(),
      followUpIssue: async () => {
        throw new Error('forced auto-flush follow-up failure')
      },
    }

    handleTurnCompleted(ctx, issue.id, executionId)

    // With the old 3-second SETTLE_GRACE_MS, this would auto-settle.
    // Now: process alive → no auto-settle. We simulate process exit
    // by calling flushSettleTimer directly (what monitorCompletion does).
    await waitFor(async () => {
      const [row] = await db
        .select({ sessionStatus: issuesTable.sessionStatus })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))
      return row?.sessionStatus === 'completed'
    }, 3000)

    flushSettleTimer(ctx, managed)

    await waitFor(async () => {
      const [row] = await db
        .select({ statusId: issuesTable.statusId })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))
      return row?.statusId === 'review'
    }, 3000)

    const pending = await getPendingMessages(issue.id)
    expect(pending.length).toBeGreaterThanOrEqual(1)
    expect(pending.some(p => p.content === pendingPrompt)).toBe(true)
  }, { timeout: 10000 })
})

describe('turn completion — follow-up cancels grace settle', () => {
  // Companion to "ACP engine delayed auto-settle": that test proves the
  // grace timer fires; this one proves the timer is correctly *cancelled*
  // when a follow-up arrives during the grace window. Together they pin
  // down the user-reported behavior — "executions don't move to review
  // when alone, but DO stay in working when I follow up immediately."
  //
  // We simulate START_TURN by flipping `turnSettled = false` (which is
  // exactly what the state reducer does when a new turn begins). All three
  // turnSettled guards inside settleAfterGrace must see the flip and bail.
  test(
    'follow-up within ACP grace window keeps issue in working',
    async () => {
      const issue = await createWorkingIssue(`turn-completion-followup-${Date.now()}`)
      const executionId = `exec-followup-${Date.now()}`
      const managed: ManagedProcess = {
        executionId,
        issueId: issue.id,
        engineType: 'acp',
        process: {
          subprocess: { exited: new Promise(() => {}) }, // never exits
        } as any,
        state: 'running',
        startedAt: new Date(),
        logs: new ExecutionStore(executionId),
        retryCount: 0,
        turnInFlight: true,
        queueCancelRequested: false,
        logicalFailure: false,
        turnSettled: false,
        slashCommands: [],
        agents: [],
        plugins: [],
        keepAlive: false,
        lastActivityAt: new Date(),
        pendingInputs: [],
      }

      const ctx: EngineContext = {
        pm: {
          get: (id: string) => (id === executionId ? ({ meta: managed } as any) : undefined),
          getActive: () => [],
        } as any,
        issueOpLocks: new Map(),
        entryCounters: new Map(),
        turnIndexes: new Map(),
        userMessageIds: new Map(),
        lastErrors: new Map(),
        lockDepth: new Map(),
        followUpIssue: null,
      }

      handleTurnCompleted(ctx, issue.id, executionId)

      // After Phase 1 sets sessionStatus='completed', flip the turn flag —
      // a follow-up arrived during the grace window. Without giving the
      // Phase 1 async work a microtask to land first, the await inside
      // settleAfterGrace would see managed.turnSettled=true at every guard.
      await new Promise(r => setTimeout(r, 50))
      managed.turnSettled = false
      managed.turnInFlight = true

      // Wait past the 5s ACP grace plus settle work; if any guard missed
      // the flip, autoMoveToReview would have flipped statusId by now.
      await new Promise(r => setTimeout(r, 5500))

      const [row] = await db
        .select({ statusId: issuesTable.statusId, sessionStatus: issuesTable.sessionStatus })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))

      // Issue must remain in working — Phase 1 updates sessionStatus to
      // 'completed' synchronously, but Phase 2's autoMoveToReview must
      // have been skipped by the turnSettled guards.
      expect(row?.statusId).toBe('working')
      expect(row?.sessionStatus).toBe('completed')
    },
    { timeout: 15000 },
  )
})

describe('turn completion — non-ACP engines still auto-settle', () => {
  test(
    'claude-code alive → turn completion DOES auto-settle',
    async () => {
      const issue = await createWorkingIssue(`turn-completion-claude-${Date.now()}`)
      const executionId = `exec-claude-${Date.now()}`
      const managed: ManagedProcess = {
        executionId,
        issueId: issue.id,
        engineType: 'claude-code',
        process: {
          subprocess: { exited: new Promise(() => {}) }, // never exits
        } as any,
        state: 'running',
        startedAt: new Date(),
        logs: new ExecutionStore(executionId),
        retryCount: 0,
        turnInFlight: true,
        queueCancelRequested: false,
        logicalFailure: false,
        turnSettled: false,
        slashCommands: [],
        agents: [],
        plugins: [],
        keepAlive: false,
        lastActivityAt: new Date(),
        pendingInputs: [],
      }

      const ctx: EngineContext = {
        pm: {
          get: (id: string) => (id === executionId ? ({ meta: managed } as any) : undefined),
          getActive: () => [],
        } as any,
        issueOpLocks: new Map(),
        entryCounters: new Map(),
        turnIndexes: new Map(),
        userMessageIds: new Map(),
        lastErrors: new Map(),
        lockDepth: new Map(),
        followUpIssue: null,
      }

      handleTurnCompleted(ctx, issue.id, executionId)

      // Claude Code should auto-settle (move to review) even though process is alive
      await waitFor(async () => {
        const [row] = await db
          .select({ statusId: issuesTable.statusId })
          .from(issuesTable)
          .where(eq(issuesTable.id, issue.id))
        return row?.statusId === 'review'
      }, 3000)

      const [row] = await db
        .select({ statusId: issuesTable.statusId, sessionStatus: issuesTable.sessionStatus })
        .from(issuesTable)
        .where(eq(issuesTable.id, issue.id))

      expect(row?.statusId).toBe('review')
      expect(row?.sessionStatus).toBe('completed')
    },
    { timeout: 10000 },
  )
})

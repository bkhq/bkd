import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { reconcileStaleWorkingIssues } from '@/engines/reconciler'
import { appEvents } from '@/events'
/**
 * A start is already `working` long before its process registers: the caller
 * moves the issue to working, the engine operation then takes the issue lock,
 * writes sessionStatus='running' and awaits the executor's spawn, and only
 * registers the process once that resolves. A reconciler pass landing in that
 * window used to mark the issue failed/review while the turn ran to completion.
 */
import './setup'

let projectId: string

async function createDirectIssue(overrides: {
  statusId: string
  sessionStatus?: string | null
  title?: string
}) {
  const [maxRow] = await db.select({ maxNum: db.$count(issuesTable) }).from(issuesTable)
  const num = (maxRow?.maxNum ?? 0) + 1

  const [row] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: overrides.statusId,
      issueNumber: num,
      title: overrides.title ?? `Start Race Issue ${num}`,
      engineType: 'codex',
      sessionStatus: overrides.sessionStatus ?? null,
      prompt: 'test prompt',
      model: 'auto',
    })
    .returning()

  return row!
}

async function getIssue(id: string) {
  const [row] = await db.select().from(issuesTable).where(eq(issuesTable.id, id))
  return row
}

/** A promise plus its resolver, standing in for a spawn held mid-flight. */
function gate() {
  let open!: () => void
  const held = new Promise<void>((resolve) => {
    open = resolve
  })
  return { held, open }
}

beforeAll(async () => {
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: 'Start Race Test Project',
      alias: `start-race-test-${Date.now()}`,
    })
    .returning()
  projectId = p!.id
})

describe('trackStart', () => {
  test('reports a start in flight only while it runs', async () => {
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'running' })
    const { held, open } = gate()

    expect(issueEngine.isStarting(issue.id)).toBe(false)
    const start = issueEngine.trackStart(issue.id, () => held)
    // Synchronous increment: no await has run yet.
    expect(issueEngine.isStarting(issue.id)).toBe(true)

    open()
    await start
    expect(issueEngine.isStarting(issue.id)).toBe(false)
  })

  test('releases the start even when it throws', async () => {
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'running' })

    await expect(
      issueEngine.trackStart(issue.id, () => Promise.reject(new Error('spawn failed'))),
    ).rejects.toThrow('spawn failed')
    expect(issueEngine.isStarting(issue.id)).toBe(false)
  })

  test('stays in flight until the last concurrent start finishes', async () => {
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'running' })
    const first = gate()
    const second = gate()

    const a = issueEngine.trackStart(issue.id, () => first.held)
    const b = issueEngine.trackStart(issue.id, () => second.held)

    first.open()
    await a
    expect(issueEngine.isStarting(issue.id)).toBe(true)

    second.open()
    await b
    expect(issueEngine.isStarting(issue.id)).toBe(false)
  })
})

describe('reconcileStaleWorkingIssues with a start in flight', () => {
  test('leaves a running issue alone while its spawn is held', async () => {
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'running' })
    const { held, open } = gate()

    const start = issueEngine.trackStart(issue.id, () => held)
    await reconcileStaleWorkingIssues()

    const duringSpawn = await getIssue(issue.id)
    expect(duringSpawn!.statusId).toBe('working')
    expect(duringSpawn!.sessionStatus).toBe('running')

    open()
    await start
  })

  test('leaves an issue alone before the engine writes running', async () => {
    // The window between ensureWorking() and the engine taking the issue lock:
    // working, with the previous terminal session status still in place.
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'completed' })
    const { held, open } = gate()

    const start = issueEngine.trackStart(issue.id, () => held)
    await reconcileStaleWorkingIssues()

    const beforeLock = await getIssue(issue.id)
    expect(beforeLock!.statusId).toBe('working')

    open()
    await start
  })

  test('still repairs a genuinely stale issue alongside a starting one', async () => {
    const starting = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
      title: 'Starting',
    })
    const stale = await createDirectIssue({
      statusId: 'working',
      sessionStatus: 'running',
      title: 'Genuinely stale',
    })
    const { held, open } = gate()

    const start = issueEngine.trackStart(starting.id, () => held)
    await reconcileStaleWorkingIssues()

    expect((await getIssue(starting.id))!.statusId).toBe('working')
    const repaired = await getIssue(stale.id)
    expect(repaired!.statusId).toBe('review')
    expect(repaired!.sessionStatus).toBe('failed')

    open()
    await start
  })
})

describe('reconciler issue-updated payload', () => {
  test('reports the rewritten session status', async () => {
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'running' })
    const changes: Record<string, unknown>[] = []
    const off = appEvents.on('issue-updated', (payload) => {
      if (payload.issueId === issue.id) changes.push(payload.changes as Record<string, unknown>)
    })

    try {
      await reconcileStaleWorkingIssues()
    } finally {
      off()
    }

    expect(changes).toContainEqual({ statusId: 'review', sessionStatus: 'failed' })
  })

  test('reports status only when the session status was already terminal', async () => {
    const issue = await createDirectIssue({ statusId: 'working', sessionStatus: 'completed' })
    const changes: Record<string, unknown>[] = []
    const off = appEvents.on('issue-updated', (payload) => {
      if (payload.issueId === issue.id) changes.push(payload.changes as Record<string, unknown>)
    })

    try {
      await reconcileStaleWorkingIssues()
    } finally {
      off()
    }

    expect(changes).toContainEqual({ statusId: 'review' })
  })
})

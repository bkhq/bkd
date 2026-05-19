import { and, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { db } from '@/db'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'

const PROJECT_ALIAS = '__cockpit__'
const PROJECT_NAME = 'Cockpit (internal)'
const ASSISTANT_ID_KEY = 'cockpit:assistantIssueId'

export async function ensureCockpitProject(): Promise<{
  id: string
  name: string
  alias: string
}> {
  const [existing] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, alias: projectsTable.alias })
    .from(projectsTable)
    .where(and(eq(projectsTable.alias, PROJECT_ALIAS), eq(projectsTable.isDeleted, 0)))

  if (existing) return existing

  const [created] = await db
    .insert(projectsTable)
    .values({
      name: PROJECT_NAME,
      alias: PROJECT_ALIAS,
      description: 'Internal home for the cockpit AI assistant. Hidden from regular listings.',
      isArchived: 1,
    })
    .returning({ id: projectsTable.id, name: projectsTable.name, alias: projectsTable.alias })
  return created
}

export async function ensureAssistantIssue(projectId: string): Promise<{
  id: string
  isFresh: boolean
}> {
  const storedId = await getAppSetting(ASSISTANT_ID_KEY)
  if (storedId) {
    const [existing] = await db
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(and(eq(issuesTable.id, storedId), eq(issuesTable.isDeleted, 0)))
    if (existing) return { id: existing.id, isFresh: false }
    // stored id is stale — fall through to create a new one
  }

  const [maxNumRow] = await db
    .select({ maxNum: max(issuesTable.issueNumber) })
    .from(issuesTable)
    .where(eq(issuesTable.projectId, projectId))
  const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

  const [lastItem] = await db
    .select({ sortOrder: issuesTable.sortOrder })
    .from(issuesTable)
    .where(and(
      eq(issuesTable.projectId, projectId),
      eq(issuesTable.isDeleted, 0),
    ))
    .orderBy(desc(issuesTable.sortOrder))
    .limit(1)
  const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

  const [created] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'working',
      issueNumber,
      title: '[Cockpit] Assistant',
      tag: JSON.stringify(['cockpit', 'assistant']),
      sortOrder,
      engineType: 'claude-code-sdk',
      prompt: 'Cockpit assistant session',
      isHidden: true,
    })
    .returning({ id: issuesTable.id })

  await setAppSetting(ASSISTANT_ID_KEY, created.id)
  return { id: created.id, isFresh: true }
}

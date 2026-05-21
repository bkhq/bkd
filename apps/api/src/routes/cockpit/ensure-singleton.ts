import { and, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { db } from '@/db'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { ROOT_DIR } from '@/root'

const PROJECT_ALIAS = '__cockpit__'
const PROJECT_NAME = 'Cockpit (internal)'
const ASSISTANT_ID_KEY = 'cockpit:assistantIssueId'
const SECRETARY_ID_KEY = 'cockpit:secretaryIssueId'

export async function ensureCockpitProject(): Promise<{
  id: string
  name: string
  alias: string
}> {
  const [existing] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      alias: projectsTable.alias,
      directory: projectsTable.directory,
    })
    .from(projectsTable)
    .where(and(eq(projectsTable.alias, PROJECT_ALIAS), eq(projectsTable.isDeleted, 0)))

  if (existing) {
    // Backfill `directory` for legacy installs that created the cockpit
    // project before this field was set. Without it the `/changes` route
    // returns 400 and DiffPanel can't surface anything the assistant edits.
    if (!existing.directory) {
      await db
        .update(projectsTable)
        .set({ directory: ROOT_DIR, updatedAt: new Date() })
        .where(eq(projectsTable.id, existing.id))
    }
    return { id: existing.id, name: existing.name, alias: existing.alias }
  }

  const [created] = await db
    .insert(projectsTable)
    .values({
      name: PROJECT_NAME,
      alias: PROJECT_ALIAS,
      description: 'Internal home for the cockpit AI assistant. Hidden from regular listings.',
      directory: ROOT_DIR,
      isArchived: 1,
    })
    .returning({ id: projectsTable.id, name: projectsTable.name, alias: projectsTable.alias })
  return created
}

/**
 * Resolve a hidden singleton issue tracked by an `appSettings` pointer key.
 * Used for both the cockpit chat assistant and the background secretary —
 * each is a single long-lived hidden issue, not a per-request one.
 */
async function ensureSingletonIssue(
  projectId: string,
  opts: { idKey: string, title: string, tag: string[], engineType: string },
): Promise<{ id: string, isFresh: boolean }> {
  const storedId = await getAppSetting(opts.idKey)
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
      title: opts.title,
      tag: JSON.stringify(opts.tag),
      sortOrder,
      engineType: opts.engineType,
      prompt: opts.title,
      isHidden: true,
    })
    .returning({ id: issuesTable.id })

  await setAppSetting(opts.idKey, created.id)
  return { id: created.id, isFresh: true }
}

export function ensureAssistantIssue(projectId: string): Promise<{
  id: string
  isFresh: boolean
}> {
  return ensureSingletonIssue(projectId, {
    idKey: ASSISTANT_ID_KEY,
    title: '[Cockpit] Assistant',
    tag: ['cockpit', 'assistant'],
    engineType: 'claude-code-sdk',
  })
}

/**
 * The background secretary issue (PLAN-022 / COCKPIT-008). A hidden,
 * long-lived issue the cockpit reuses to run engine-agnostic enrichment
 * turns. Its engine is set per-run from the `cockpit:secretaryEngine`
 * setting, so `engineType` here is only the initial seed.
 */
export function ensureSecretaryIssue(projectId: string): Promise<{
  id: string
  isFresh: boolean
}> {
  return ensureSingletonIssue(projectId, {
    idKey: SECRETARY_ID_KEY,
    title: '[Cockpit] Secretary',
    tag: ['cockpit', 'secretary'],
    engineType: 'claude-code-sdk',
  })
}

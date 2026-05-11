import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { db } from '@/db'
import { notes as notesTable, projects as projectsTable } from '@/db/schema'
import type { EngineType, PermissionPolicy } from '@/engines/types'
import { BUILT_IN_PROFILES } from '@/engines/types'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

// ---------- Error classification ----------

export function isMissingExternalSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('no conversation found with session id') ||
    (msg.includes('no conversation found') && msg.includes('session id'))
  )
}

// ---------- Permission options ----------

export function getPermissionOptions(
  engineType: EngineType,
  overridePolicy?: PermissionPolicy,
): {
  permissionMode: PermissionPolicy
} {
  const profile = BUILT_IN_PROFILES[engineType]
  const policy = overridePolicy ?? profile?.permissionPolicy ?? 'supervised'

  return { permissionMode: policy }
}

// ---------- Working directory ----------

export async function resolveWorkingDir(projectId: string): Promise<string> {
  const [project] = await db
    .select({ directory: projectsTable.directory })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
  const dir = project?.directory ? resolve(project.directory) : ROOT_DIR
  await mkdir(dir, { recursive: true })
  const s = await stat(dir)
  if (!s.isDirectory()) {
    throw new Error(`Project directory is not a directory: ${dir}`)
  }
  return dir
}

// ---------- Project execution context ----------

export interface ProjectExecContext {
  systemPrompt?: string
  envVars?: Record<string, string>
}

export async function getProjectExecContext(projectId: string): Promise<ProjectExecContext> {
  const [project] = await db
    .select({
      systemPrompt: projectsTable.systemPrompt,
      envVars: projectsTable.envVars,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
  if (!project) return {}
  let envVars: Record<string, string> | undefined
  if (project.envVars) {
    try {
      const parsed = JSON.parse(project.envVars) as Record<string, string>
      envVars = Object.keys(parsed).length > 0 ? parsed : undefined
    } catch {
      // ignore malformed JSON
    }
  }

  // Load active memory notes for this project
  const memoryNotes = await loadProjectMemories(projectId)
  const effectivePrompt = buildPromptWithMemories(project.systemPrompt ?? undefined, memoryNotes)

  return {
    systemPrompt: effectivePrompt,
    envVars,
  }
}

/** Load active (non-archived) memory notes scoped to project + global. */
async function loadProjectMemories(projectId: string) {
  try {
    const rows = await db
      .select({
        title: notesTable.title,
        content: notesTable.content,
        tags: notesTable.tags,
        isPinned: notesTable.isPinned,
      })
      .from(notesTable)
      .where(
        and(
          eq(notesTable.isDeleted, 0),
          eq(notesTable.isArchived, false),
          or(eq(notesTable.projectId, projectId), isNull(notesTable.projectId)),
        ),
      )
      .orderBy(desc(notesTable.isPinned), desc(notesTable.updatedAt))
      .limit(10)

    return rows.map(row => ({
      ...row,
      tags: parseNoteTags(row.tags),
    }))
  } catch (err) {
    logger.warn({ err, projectId }, 'load_project_memories_failed')
    return []
  }
}

function parseNoteTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildPromptWithMemories(basePrompt: string | undefined, memories: Array<{
  title: string
  content: string
  tags: string[]
  isPinned: boolean
}>): string | undefined {
  if (!memories.length && !basePrompt) return undefined

  const memorySection = memories.length > 0
    ? `## Project Knowledge Base\n\n${memories.map((m, i) => `${i + 1}. **[${m.tags.join(', ') || 'note'}]** ${m.title}\n   ${m.content.slice(0, 300).replace(/\n/g, ' ')}${m.content.length > 300 ? '...' : ''}`).join('\n\n')}\n\n---\n`
    : ''

  if (!basePrompt) return memorySection || undefined
  if (!memorySection) return basePrompt

  return `${memorySection}\n${basePrompt}`
}

/** @deprecated Use getProjectExecContext instead */
export async function getProjectEnvVars(
  projectId: string,
): Promise<Record<string, string> | undefined> {
  const ctx = await getProjectExecContext(projectId)
  return ctx.envVars
}

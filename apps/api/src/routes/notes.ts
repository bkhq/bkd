import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { db } from '@/db'
import { notes } from '@/db/schema'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const notesRoutes = createOpenAPIRouter()

const notDeleted = eq(notes.isDeleted, 0)

// GET /api/notes?projectId=xxx&archived=true|false
notesRoutes.openapi(R.listNotes, async (c) => {
  try {
    const projectId = c.req.query('projectId')
    const archived = c.req.query('archived') === 'true'

    const baseWhere = and(notDeleted, eq(notes.isArchived, archived))

    const rows = await db
      .select()
      .from(notes)
      .where(
        projectId
          ? and(baseWhere, or(eq(notes.projectId, projectId), isNull(notes.projectId)))
          : baseWhere,
      )
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt))

    // Parse JSON tags
    const parsed = rows.map(row => ({
      ...row,
      tags: parseTags(row.tags),
    }))

    return c.json({ success: true, data: parsed }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'notes_list_failed')
    return c.json({ success: false, error: 'Failed to list notes' }, 500 as const)
  }
})

// POST /api/notes
notesRoutes.openapi(R.createNote, async (c) => {
  try {
    const { title, content, projectId, issueId, source, tags } = c.req.valid('json')
    const [row] = await db
      .insert(notes)
      .values({
        title,
        content,
        projectId: projectId ?? null,
        issueId: issueId ?? null,
        source: source ?? 'manual',
        tags: JSON.stringify(tags ?? []),
      })
      .returning()
    return c.json({ success: true, data: { ...row, tags: tags ?? [] } }, 201 as const)
  } catch (err) {
    logger.error({ err }, 'notes_create_failed')
    return c.json({ success: false, error: 'Failed to create note' }, 500 as const)
  }
})

// PATCH /api/notes/:noteId
notesRoutes.openapi(R.updateNote, async (c) => {
  try {
    const noteId = c.req.param('noteId')
    const data = c.req.valid('json')

    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() }
    if (data.tags) {
      updateData.tags = JSON.stringify(data.tags)
    }
    delete updateData.id

    const [row] = await db
      .update(notes)
      .set(updateData)
      .where(and(eq(notes.id, noteId), notDeleted))
      .returning()

    if (!row) {
      return c.json({ success: false, error: 'Note not found' }, 404 as const)
    }

    return c.json(
      { success: true, data: { ...row, tags: parseTags(row.tags) } },
      200 as const,
    )
  } catch (err) {
    logger.error({ err }, 'notes_update_failed')
    return c.json({ success: false, error: 'Failed to update note' }, 500 as const)
  }
})

// DELETE /api/notes/:noteId (soft delete)
notesRoutes.openapi(R.deleteNote, async (c) => {
  try {
    const noteId = c.req.param('noteId')
    const [row] = await db
      .update(notes)
      .set({ isDeleted: 1, updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), notDeleted))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Note not found' }, 404 as const)
    }
    return c.json({ success: true, data: { id: noteId } }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'notes_delete_failed')
    return c.json({ success: false, error: 'Failed to delete note' }, 500 as const)
  }
})

// POST /api/notes/query — Smart memory retrieval
notesRoutes.openapi(R.queryNotes, async (c) => {
  try {
    const { prompt, projectId, limit = 5 } = c.req.valid('json')

    // Extract intent tags from prompt
    const intentTags = extractIntentTags(prompt)

    // Build query: match project + active (not archived) + tag overlap
    const baseWhere = and(notDeleted, eq(notes.isArchived, false))

    const rows = await db
      .select()
      .from(notes)
      .where(
        projectId
          ? and(baseWhere, or(eq(notes.projectId, projectId), isNull(notes.projectId)))
          : baseWhere,
      )
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt))

    // Score by tag overlap + pinned boost
    const scored = rows.map((row) => {
      const noteTags = parseTags(row.tags)
      const overlap = noteTags.filter(t => intentTags.includes(t)).length
      return {
        ...row,
        tags: noteTags,
        score: overlap * 2 + (row.isPinned ? 10 : 0),
      }
    })

    scored.sort((a, b) => b.score - a.score)

    return c.json({ success: true, data: scored.slice(0, limit) }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'notes_query_failed')
    return c.json({ success: false, error: 'Failed to query notes' }, 500 as const)
  }
})

// ── Helpers ──────────────────────────────────────────────

function parseTags(tagsRaw: string | null): string[] {
  if (!tagsRaw) return []
  try {
    const parsed = JSON.parse(tagsRaw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Extract intent tags from a prompt using keyword matching. */
function extractIntentTags(prompt: string): string[] {
  const lower = prompt.toLowerCase()
  const tags = new Set<string>()

  const KEYWORD_TAGS: Record<string, string[]> = {
    登录: ['topic:auth'],
    auth: ['topic:auth'],
    jwt: ['topic:auth', 'tech:jwt'],
    token: ['topic:auth'],
    数据库: ['topic:db'],
    db: ['topic:db'],
    drizzle: ['topic:db', 'tech:drizzle'],
    迁移: ['topic:db', 'topic:migration'],
    migration: ['topic:db', 'topic:migration'],
    schema: ['topic:db'],
    react: ['tech:react'],
    query: ['tech:react-query'],
    api: ['topic:api'],
    路由: ['topic:api'],
    route: ['topic:api'],
    测试: ['topic:testing'],
    test: ['topic:testing'],
    部署: ['topic:deploy'],
    deploy: ['topic:deploy'],
    docker: ['topic:deploy', 'tech:docker'],
    缓存: ['topic:cache'],
    cache: ['topic:cache'],
    配置: ['topic:config'],
    config: ['topic:config'],
    类型: ['topic:types'],
    type: ['topic:types'],
    类型安全: ['topic:types'],
  }

  for (const [keyword, tagList] of Object.entries(KEYWORD_TAGS)) {
    if (lower.includes(keyword.toLowerCase())) {
      tagList.forEach(t => tags.add(t))
    }
  }

  return Array.from(tags)
}

export default notesRoutes

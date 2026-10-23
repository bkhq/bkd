import type { Context } from 'hono'
import { findProject } from '@/db/helpers'
import { logger } from '@/logger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenAPIRouter } from '@/openapi/hono'
import { SkillUploadFieldsSchema } from '@/openapi/schemas'
import { checkSkillUpdates } from '@/skills/updates'
import { MAX_SKILL_UPLOAD_BYTES, uploadSkills } from '@/skills/upload'
import { parseMultipartUpload, UploadError } from '@/uploads'
import { cancelSkillsOperation, getSkillsOperation, isSkillsCliAvailable, startSkillsOperation } from '@/skills/cli'
import * as R from '@/openapi/routes'
import {
  copySkill,
  createSkill,
  deleteSkill,
  getSkill,
  listSkillFiles,
  listSkills,
  readSkillFile,
  SkillError,
  writeSkillFile,
} from '@/skills/service'

const skillsRoutes = createOpenAPIRouter()

class NotFound extends Error {}

/** The project's directory, or null for global-only requests; throws NotFound for an unknown project. */
async function projectDir(projectId: string | undefined, required: boolean): Promise<string | null> {
  if (!projectId) {
    if (required) throw new SkillError('projectId is required for project skills', 400)
    return null
  }
  const project = await findProject(projectId)
  if (!project) throw new NotFound('Project not found')
  return project.directory ?? null
}

function fail(c: Context, err: unknown, what: string) {
  if (err instanceof NotFound) return c.json({ success: false as const, error: err.message }, 404 as const)
  if (err instanceof SkillError) return c.json({ success: false as const, error: err.message }, err.status)
  logger.error({ err }, `skills_${what}_failed`)
  return c.json({ success: false as const, error: `Failed to ${what.replace('_', ' ')}` }, 500 as const)
}

// GET /api/skills
skillsRoutes.openapi(R.listSkillsRoute, async (c) => {
  try {
    const { projectId } = c.req.valid('query')
    const skills = await listSkills(await projectDir(projectId, false))
    return c.json({ success: true as const, data: { skills, cliAvailable: isSkillsCliAvailable() } }, 200 as const)
  } catch (err) {
    return fail(c, err, 'list') as never
  }
})

// GET /api/skills/updates
skillsRoutes.openapi(R.skillUpdatesRoute, async (c) => {
  try {
    const { projectId, location, name } = c.req.valid('query')
    const only = location && name ? { location, name } : undefined
    const updates = await checkSkillUpdates(await projectDir(projectId, false), only)
    return c.json({ success: true as const, data: { updates } }, 200 as const)
  } catch (err) {
    return fail(c, err, 'check_updates') as never
  }
})

// POST /api/skills/upload (multipart, streamed to a temp dir; fields validated below)
skillsRoutes.openAPIRegistry.registerPath(R.uploadSkillsRoute)
skillsRoutes.post('/upload', async (c) => {
  if (!(c.req.header('content-type') ?? '').includes('multipart/form-data')) {
    return c.json({ success: false as const, error: 'Expected multipart/form-data' }, 400)
  }
  const staging = await mkdtemp(join(tmpdir(), 'bkd-skill-upload-'))
  try {
    const upload = await parseMultipartUpload(c.req.raw, { dir: staging, storedName: id => id, maxUploadSize: MAX_SKILL_UPLOAD_BYTES })
    const fields = SkillUploadFieldsSchema.safeParse(Object.fromEntries(upload.fields))
    if (!fields.success) return c.json({ success: false as const, error: fields.error.issues.map(i => i.message).join(', ') }, 400)
    if (upload.files.length !== 1) return c.json({ success: false as const, error: 'Upload exactly one file' }, 400)
    const dir = await projectDir(fields.data.projectId, fields.data.scope === 'project')
    const result = await uploadSkills(upload.files[0]!, fields.data.scope, dir)
    logger.info({ created: result.created.map(s => s.name), conflicts: result.conflicts }, 'skills_uploaded')
    return c.json({ success: true as const, data: result }, 200)
  } catch (err) {
    if (err instanceof UploadError) return c.json({ success: false as const, error: err.message }, err.status)
    return fail(c, err, 'upload')
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
})

// POST /api/skills/operations
skillsRoutes.openapi(R.startSkillsOperationRoute, async (c) => {
  try {
    const { projectId, ...input } = c.req.valid('json')
    const dir = await projectDir(projectId, input.scope === 'project')
    const op = await startSkillsOperation({ ...input, projectDir: dir })
    logger.info({ id: op.id, op: op.op, scope: op.scope }, 'skills_operation_started')
    return c.json({ success: true as const, data: op }, 202 as const)
  } catch (err) {
    return fail(c, err, 'start_operation') as never
  }
})

// GET /api/skills/operations/:id
skillsRoutes.openapi(R.getSkillsOperationRoute, async (c) => {
  const op = getSkillsOperation(c.req.valid('param').id)
  if (!op) return c.json({ success: false as const, error: 'Operation not found' }, 404 as const)
  return c.json({ success: true as const, data: op }, 200 as const)
})

// POST /api/skills/operations/:id/cancel
skillsRoutes.openapi(R.cancelSkillsOperationRoute, async (c) => {
  const { id } = c.req.valid('param')
  if (!cancelSkillsOperation(id)) return c.json({ success: false as const, error: 'No such running operation' }, 404 as const)
  return c.json({ success: true as const, data: { id } }, 200 as const)
})

// GET /api/skills/:location/:name/files
skillsRoutes.openapi(R.listSkillFilesRoute, async (c) => {
  try {
    const { location, name } = c.req.valid('param')
    const { projectId } = c.req.valid('query')
    const dir = await projectDir(projectId, location.startsWith('project'))
    const skill = await getSkill(location, name, dir)
    return c.json({ success: true as const, data: await listSkillFiles(skill) }, 200 as const)
  } catch (err) {
    return fail(c, err, 'list_files') as never
  }
})

// GET /api/skills/:location/:name/file?path=
skillsRoutes.openapi(R.readSkillFileRoute, async (c) => {
  try {
    const { location, name } = c.req.valid('param')
    const { projectId, path } = c.req.valid('query')
    const dir = await projectDir(projectId, location.startsWith('project'))
    const skill = await getSkill(location, name, dir)
    return c.json({ success: true as const, data: await readSkillFile(skill, path) }, 200 as const)
  } catch (err) {
    return fail(c, err, 'read_file') as never
  }
})

// PUT /api/skills/:location/:name/file
skillsRoutes.openapi(R.saveSkillFileRoute, async (c) => {
  try {
    const { location, name } = c.req.valid('param')
    const { projectId, path, content } = c.req.valid('json')
    const dir = await projectDir(projectId, location.startsWith('project'))
    const skill = await getSkill(location, name, dir)
    await writeSkillFile(skill, path, content)
    return c.json({ success: true as const, data: { path, content, binary: false } }, 200 as const)
  } catch (err) {
    return fail(c, err, 'save_file') as never
  }
})

// POST /api/skills
skillsRoutes.openapi(R.createSkillRoute, async (c) => {
  try {
    const { scope, name, description, projectId } = c.req.valid('json')
    const dir = await projectDir(projectId, scope === 'project')
    const skill = await createSkill(scope, name, description, dir)
    logger.info({ scope, name }, 'skill_created')
    return c.json({ success: true as const, data: skill }, 201 as const)
  } catch (err) {
    return fail(c, err, 'create') as never
  }
})

// POST /api/skills/:location/:name/copy
skillsRoutes.openapi(R.copySkillRoute, async (c) => {
  try {
    const { location, name } = c.req.valid('param')
    const { name: newName, projectId } = c.req.valid('json')
    const dir = await projectDir(projectId, location.startsWith('project'))
    const copy = await copySkill(await getSkill(location, name, dir), newName, dir)
    logger.info({ location, name, newName }, 'skill_copied')
    return c.json({ success: true as const, data: copy }, 201 as const)
  } catch (err) {
    return fail(c, err, 'copy') as never
  }
})

// DELETE /api/skills/:location/:name
skillsRoutes.openapi(R.deleteSkillRoute, async (c) => {
  try {
    const { location, name } = c.req.valid('param')
    const { projectId } = c.req.valid('query')
    const dir = await projectDir(projectId, location.startsWith('project'))
    await deleteSkill(await getSkill(location, name, dir))
    logger.info({ location, name }, 'skill_deleted')
    return c.json({ success: true as const, data: { name } }, 200 as const)
  } catch (err) {
    return fail(c, err, 'delete') as never
  }
})

export default skillsRoutes

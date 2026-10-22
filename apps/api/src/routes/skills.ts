import type { Context } from 'hono'
import { findProject } from '@/db/helpers'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
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
    return c.json({ success: true as const, data: { skills } }, 200 as const)
  } catch (err) {
    return fail(c, err, 'list') as never
  }
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

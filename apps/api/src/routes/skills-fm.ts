import type { Context } from 'hono'
import type { FmMount } from '@/fm/server/router'
import { realpath } from 'node:fs/promises'
import { findProject } from '@/db/helpers'
import { createFmRouter } from '@/fm/server/router'
import { assertProjectScope, listSkills } from '@/skills/service'
import { TRASH_RETENTION_DAYS, workspaceDriver } from './fm'

/**
 * One mount per skill (`<location>~<name>`): global skills, plus the project's
 * with a project id (`global` for none). Managed skills are read-only, and so are
 * a project's skills when its skill store links outside the project.
 */
export async function skillMounts(scope: string): Promise<FmMount[]> {
  let projectDir: string | null = null
  if (scope !== 'global') {
    const project = await findProject(scope)
    if (!project) return []
    projectDir = project.directory ?? null
  }
  const projectWritable = projectDir ? await assertProjectScope('project', projectDir).then(() => true, () => false) : false

  const mounts: FmMount[] = []
  for (const skill of await listSkills(projectDir)) {
    const root = await realpath(skill.path).catch(() => null)
    if (!root) continue
    mounts.push({
      id: `${skill.location}~${skill.name}`,
      label: skill.name,
      driver: workspaceDriver(root, { git: false }),
      readOnly: skill.managed || (skill.scope === 'project' && !projectWritable),
      trash: { retentionDays: TRASH_RETENTION_DAYS },
    })
  }
  return mounts
}

/** `/api/skills/fm/:projectId` — the file manager over skill directories. */
const skillsFm = createFmRouter({
  mounts: (c: Context) => skillMounts(c.req.param('projectId') ?? ''),
})

export default skillsFm

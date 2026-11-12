import { resolve, sep } from 'node:path'
import { getAppSetting } from '@/db/helpers'

export function isInsideDir(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** `dir` is inside the configured workspace root; an unset root or `/` allows everything. */
export async function isInsideWorkspace(dir: string): Promise<boolean> {
  const workspace = await getAppSetting('workspace:defaultPath')
  return !workspace || workspace === '/' || isInsideDir(resolve(dir), resolve(workspace))
}

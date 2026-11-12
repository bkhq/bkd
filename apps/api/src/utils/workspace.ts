import { realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { getAppSetting } from '@/db/helpers'

export function isInsideDir(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Real path of `path`; a part that does not exist yet is appended to its nearest existing ancestor's. */
async function realPathOf(path: string): Promise<string> {
  const missing: string[] = []
  let current = resolve(path)
  for (;;) {
    try {
      return join(await realpath(current), ...missing)
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(path)
      missing.unshift(basename(current))
      current = parent
    }
  }
}

/**
 * `dir` is inside the configured workspace root; an unset root or `/` allows
 * everything. Symlinks are resolved on both sides, so a link inside the
 * workspace that points out of it does not pass.
 */
export async function isInsideWorkspace(dir: string): Promise<boolean> {
  const workspace = await getAppSetting('workspace:defaultPath')
  if (!workspace || workspace === '/') return true
  const [real, root] = await Promise.all([realPathOf(dir), realPathOf(workspace)])
  return isInsideDir(real, root)
}

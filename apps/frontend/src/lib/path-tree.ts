/** Join a workspace root and a root-relative path ('.' is the root itself). */
export function joinRootPath(root: string | null | undefined, relative: string): string {
  if (!root) return relative
  if (relative === '.' || relative === '') return root
  return `${root.replace(/\/+$/, '')}/${relative}`
}

/** A directory has `children`; a file does not. */
export interface PathTreeNode {
  name: string
  path: string
  children?: PathTreeNode[]
}

interface MutableDir {
  dirs: Map<string, MutableDir>
  files: string[]
}

/**
 * Build a directory tree from flat file paths. Directories sort before files,
 * and chains of single-child directories collapse into one node
 * (`src/components/pages`), the way changed-file trees usually read.
 */
export function buildPathTree(paths: string[]): PathTreeNode[] {
  const root: MutableDir = { dirs: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.push(parts.at(-1)!)
  }
  return toNodes(root, '')
}

function toNodes(dir: MutableDir, prefix: string): PathTreeNode[] {
  const byName = (a: string, b: string) => a.localeCompare(b)
  const dirs = [...dir.dirs.keys()].sort(byName).map((name) => {
    let child = dir.dirs.get(name)!
    let label = name
    while (child.files.length === 0 && child.dirs.size === 1) {
      const [nextName, next] = [...child.dirs][0]
      label = `${label}/${nextName}`
      child = next
    }
    const path = prefix + label
    return { name: label, path, children: toNodes(child, `${path}/`) }
  })
  const files = [...dir.files].sort(byName).map(name => ({ name, path: prefix + name }))
  return [...dirs, ...files]
}

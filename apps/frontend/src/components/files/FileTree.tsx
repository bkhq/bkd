import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectFiles } from '@/hooks/use-kanban'
import type { FileEntry } from '@/types/kanban'
import { TreeRow } from './TreeRow'

type RenderMenu = (path: string, type: FileEntry['type']) => ReactNode

/**
 * Lazily loaded directory tree of a workspace root: a directory lists its
 * entries only once expanded. Ancestors of `currentPath` open automatically.
 */
export function FileTree({
  root,
  currentPath,
  onOpenFile,
  collapseVersion = 0,
  renderMenu,
}: {
  root: string
  currentPath: string
  onOpenFile: (path: string) => void
  /** Bump to collapse every open directory. */
  collapseVersion?: number
  /** Right-click menu items for an entry. */
  renderMenu?: RenderMenu
}) {
  return (
    <div className="h-full overflow-y-auto px-1 py-2">
      <TreeDir
        root={root}
        path="."
        depth={0}
        currentPath={currentPath}
        onOpenFile={onOpenFile}
        collapseVersion={collapseVersion}
        renderMenu={renderMenu}
      />
    </div>
  )
}

function TreeDir({
  root,
  path,
  depth,
  currentPath,
  onOpenFile,
  collapseVersion,
  renderMenu,
}: {
  root: string
  path: string
  depth: number
  currentPath: string
  onOpenFile: (path: string) => void
  collapseVersion: number
  renderMenu?: RenderMenu
}) {
  const { t } = useTranslation()
  const { data: listing, isLoading } = useProjectFiles(root, path)

  if (isLoading) {
    return <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 20 }}>{t('common.loading')}</p>
  }
  if (listing?.type !== 'directory') return null

  const entries = [...listing.entries].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
  )
  return entries.map(entry => (
    <TreeEntry
      key={entry.name}
      root={root}
      parent={path}
      entry={entry}
      depth={depth}
      currentPath={currentPath}
      onOpenFile={onOpenFile}
      collapseVersion={collapseVersion}
      renderMenu={renderMenu}
    />
  ))
}

function TreeEntry({
  root,
  parent,
  entry,
  depth,
  currentPath,
  onOpenFile,
  collapseVersion,
  renderMenu,
}: {
  root: string
  parent: string
  entry: FileEntry
  depth: number
  currentPath: string
  onOpenFile: (path: string) => void
  collapseVersion: number
  renderMenu?: RenderMenu
}) {
  const path = parent === '.' ? entry.name : `${parent}/${entry.name}`
  const isAncestor = currentPath.startsWith(`${path}/`)
  const [expanded, setExpanded] = useState(isAncestor)
  // Open when navigation elsewhere moves the current path inside this directory
  const [wasAncestor, setWasAncestor] = useState(isAncestor)
  if (isAncestor !== wasAncestor) {
    setWasAncestor(isAncestor)
    if (isAncestor) setExpanded(true)
  }
  const [seenCollapse, setSeenCollapse] = useState(collapseVersion)
  if (collapseVersion !== seenCollapse) {
    setSeenCollapse(collapseVersion)
    setExpanded(false)
  }

  const menu = renderMenu?.(path, entry.type)

  if (entry.type === 'file') {
    return (
      <TreeRow
        depth={depth}
        name={entry.name}
        isDir={false}
        title={path}
        selected={currentPath === path}
        onClick={() => onOpenFile(path)}
        menu={menu}
      />
    )
  }
  return (
    <>
      <TreeRow
        depth={depth}
        name={entry.name}
        isDir
        expanded={expanded}
        selected={currentPath === path}
        onClick={() => setExpanded(v => !v)}
        menu={menu}
      />
      {expanded && (
        <TreeDir
          root={root}
          path={path}
          depth={depth + 1}
          currentPath={currentPath}
          onOpenFile={onOpenFile}
          collapseVersion={collapseVersion}
          renderMenu={renderMenu}
        />
      )}
    </>
  )
}

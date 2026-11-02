import type { ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { projectFilesQuery } from '@/hooks/use-kanban'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { FileEntry } from '@/types/kanban'
import { TreeRow } from './TreeRow'

/** Every row is one line of `text-xs` plus `py-1`. */
const ROW_HEIGHT = 24

type RenderMenu = (path: string, type: FileEntry['type']) => ReactNode

type Row =
  | { kind: 'entry', path: string, entry: FileEntry, depth: number }
  | { kind: 'loading', path: string, depth: number }

/** Directories that hold `path`, outermost first: "a/b/c" → ["a", "a/b"]. */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

function childPath(parent: string, name: string): string {
  return parent === '.' ? name : `${parent}/${name}`
}

/**
 * Lazily loaded directory tree of a workspace root: a directory lists its
 * entries only once expanded. Ancestors of `currentPath` open automatically.
 * Expanded directories flatten into one virtualized list, so a directory with
 * thousands of entries renders only the rows in view.
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
  const { t } = useTranslation()
  const hideIgnored = useFileBrowserStore(s => s.hideIgnored)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(() => new Set(ancestorsOf(currentPath)))

  // Open the ancestors when navigation moves the current path elsewhere
  const [seenPath, setSeenPath] = useState(currentPath)
  if (seenPath !== currentPath) {
    setSeenPath(currentPath)
    const missing = ancestorsOf(currentPath).filter(dir => !expanded.has(dir))
    if (missing.length > 0) setExpanded(new Set([...expanded, ...missing]))
  }
  const [seenCollapse, setSeenCollapse] = useState(collapseVersion)
  if (collapseVersion !== seenCollapse) {
    setSeenCollapse(collapseVersion)
    setExpanded(new Set())
  }

  // Load only directories that are shown: expanded, under expanded parents
  const shownDirs = ['.', ...[...expanded].filter(dir => ancestorsOf(dir).every(a => expanded.has(a)))]
  const listings = useQueries({ queries: shownDirs.map(dir => projectFilesQuery(root, dir, hideIgnored)) })
  const byDir = new Map(shownDirs.map((dir, i) => [dir, listings[i]!]))

  // Entries arrive sorted by the server (directories first, then by name)
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    const listing = byDir.get(dir)
    if (listing?.isLoading) rows.push({ kind: 'loading', path: dir, depth })
    if (listing?.data?.type !== 'directory') return
    for (const entry of listing.data.entries) {
      const path = childPath(dir, entry.name)
      rows.push({ kind: 'entry', path, entry, depth })
      if (entry.type === 'directory' && expanded.has(path)) walk(path, depth + 1)
    }
  }
  walk('.', 0)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: i => `${rows[i]!.kind}:${rows[i]!.path}`,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  const toggle = (path: string) => {
    const next = new Set(expanded)
    if (!next.delete(path)) next.add(path)
    setExpanded(next)
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-1 py-2">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!
          return (
            <div
              key={item.key}
              className="absolute left-0 top-0 w-full"
              style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              {row.kind === 'loading'
                ? (
                    <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: row.depth * 12 + 20 }}>
                      {t('common.loading')}
                    </p>
                  )
                : (
                    <TreeRow
                      depth={row.depth}
                      name={row.entry.name}
                      isDir={row.entry.type === 'directory'}
                      expanded={row.entry.type === 'directory' ? expanded.has(row.path) : undefined}
                      title={row.entry.type === 'file' ? row.path : undefined}
                      selected={currentPath === row.path}
                      onClick={() => (row.entry.type === 'file' ? onOpenFile(row.path) : toggle(row.path))}
                      menu={renderMenu?.(row.path, row.entry.type)}
                    />
                  )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

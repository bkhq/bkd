import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyPathItems, TreeRow } from '@/components/files/TreeRow'
import type { PathTreeNode } from '@/lib/path-tree'
import { buildPathTree, joinRootPath } from '@/lib/path-tree'
import type { IssueChangedFile } from '@/types/kanban'

const STATUS_LETTER: Record<IssueChangedFile['type'], { letter: string, className: string }> = {
  modified: { letter: 'M', className: 'text-amber-600 dark:text-amber-400' },
  added: { letter: 'A', className: 'text-emerald-600 dark:text-emerald-400' },
  untracked: { letter: 'U', className: 'text-emerald-600 dark:text-emerald-400' },
  deleted: { letter: 'D', className: 'text-red-600 dark:text-red-400' },
  renamed: { letter: 'R', className: 'text-blue-600 dark:text-blue-400' },
  unknown: { letter: '?', className: 'text-muted-foreground' },
}

/** Directory tree of an issue's changed files, with a name filter. */
export function ChangesTree({
  files,
  root,
  activePath,
  onSelect,
}: {
  files: IssueChangedFile[]
  /** Workspace root, for the copy-absolute-path action. */
  root?: string
  activePath: string | null
  onSelect: (path: string) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  // Directories start expanded; track the ones the user folded
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const typeByPath = useMemo(() => new Map(files.map(f => [f.path, f.type])), [files])
  const tree = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const paths = files.map(f => f.path).filter(p => !query || p.toLowerCase().includes(query))
    return buildPathTree(paths)
  }, [files, filter])

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  const renderNodes = (nodes: PathTreeNode[], depth: number) => nodes.map((node) => {
    if (node.children) {
      const expanded = !collapsed.has(node.path)
      return (
        <div key={node.path}>
          <TreeRow
            depth={depth}
            name={node.name}
            isDir
            expanded={expanded}
            onClick={() => toggleDir(node.path)}
            menu={<CopyPathItems absolute={joinRootPath(root, node.path)} relative={node.path} />}
          />
          {expanded && renderNodes(node.children, depth + 1)}
        </div>
      )
    }
    const status = STATUS_LETTER[typeByPath.get(node.path) ?? 'unknown']
    return (
      <TreeRow
        key={node.path}
        depth={depth}
        name={node.name}
        isDir={false}
        title={node.path}
        selected={node.path === activePath}
        onClick={() => onSelect(node.path)}
        menu={<CopyPathItems absolute={joinRootPath(root, node.path)} relative={node.path} />}
        trailing={<span className={`shrink-0 font-mono text-[10px] font-semibold ${status.className}`}>{status.letter}</span>}
      />
    )
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('diff.filterFiles')}
          className="h-7 w-full rounded-md border border-border/60 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-border"
        />
      </div>
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 text-[11px] font-medium text-muted-foreground">
        <span>{t('diff.changes')}</span>
        <span className="tabular-nums">{files.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {tree.length > 0
          ? renderNodes(tree, 0)
          : <p className="px-2 py-3 text-xs text-muted-foreground">{t('diff.noMatchingFiles')}</p>}
      </div>
    </div>
  )
}

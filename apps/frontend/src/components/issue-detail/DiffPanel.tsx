import { AlertTriangle, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, Copy, Ellipsis, FileSearch, ListTree, Rows2, WrapText, X } from 'lucide-react'
import type { RefObject } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer, WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { SetupWorkerPoolProps } from '@pierre/diffs/worker'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { cn } from 'cn'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TreePane } from '@/components/files/TreePane'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SidePanelButton } from '@/components/ui/side-panel'
import { useIssueChanges, useIssueFilePatch } from '@/hooks/use-kanban'
import { useTheme } from '@/hooks/use-theme'
import type { DiffStyle } from '@/stores/diff-view-store'
import { useDiffViewStore } from '@/stores/diff-view-store'
import type { IssueChangedFile } from '@/types/kanban'
import { ChangesTree } from './ChangesTree'

const LazyMultiFileDiff = lazy(() =>
  import('@pierre/diffs/react').then(m => ({ default: m.MultiFileDiff })),
)

const LazyPatchDiff = lazy(() =>
  import('@pierre/diffs/react').then(m => ({ default: m.PatchDiff })),
)

const DIFF_THEME = { light: 'github-light-default', dark: 'github-dark-default' } as const

/**
 * Syntax highlighting runs in a worker pool (a process-wide singleton) so the
 * main thread only builds DOM; diffs show as plain text until highlighted.
 */
const DIFF_WORKER_POOL: SetupWorkerPoolProps = {
  poolOptions: {
    workerFactory: () => new DiffsWorker(),
    poolSize: Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1)),
  },
  highlighterOptions: { theme: DIFF_THEME },
}

function getPatchStats(patch: string): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

type FileType = IssueChangedFile['type']

function FileTypeBadge({ type }: { type: FileType }) {
  const { t } = useTranslation()
  if (type === 'added' || type === 'untracked') {
    return (
      <span className="shrink-0 text-[10px] font-semibold leading-none text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded px-1 py-0.5">
        {t('diff.fileType.new')}
      </span>
    )
  }
  if (type === 'deleted') {
    return (
      <span className="shrink-0 text-[10px] font-semibold leading-none text-red-600 dark:text-red-400 border border-red-500/30 bg-red-500/10 rounded px-1 py-0.5">
        {t('diff.fileType.deleted')}
      </span>
    )
  }
  if (type === 'renamed') {
    return (
      <span className="shrink-0 text-[10px] font-semibold leading-none text-blue-600 dark:text-blue-400 border border-blue-500/30 bg-blue-500/10 rounded px-1 py-0.5">
        {t('diff.fileType.renamed')}
      </span>
    )
  }
  return null
}

/** Full-screen changes view with its own header (kanban issue panel). */
export function DiffPanel({
  projectId,
  issueId,
  onClose,
}: {
  projectId: string
  issueId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const changesQuery = useIssueChanges(projectId, issueId, true)
  const files = changesQuery.data?.files ?? []

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">{t('diff.changes')}</span>
            <span className="text-[11px] font-medium text-muted-foreground/60 bg-muted/50 rounded-full px-1.5 py-0.5 tabular-nums">
              {files.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150"
            aria-label={t('diff.closeDiffPanel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <DiffChanges projectId={projectId} issueId={issueId} />
      </div>
    </div>
  )
}

/** Changed-file list of an issue workspace, without the panel chrome. */
export function DiffChanges({
  projectId,
  issueId,
  toolbar,
}: {
  projectId: string
  issueId: string
  /** Show the totals / view options / expand-all bar above the list. */
  toolbar?: boolean
}) {
  const { t } = useTranslation()
  const changesQuery = useIssueChanges(projectId, issueId, true)
  const files = changesQuery.data?.files ?? []
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(() => new Set())

  const setFileOpen = useCallback((path: string, open: boolean) => {
    setOpenPaths((prev) => {
      if (prev.has(path) === open) return prev
      const next = new Set(prev)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const showTree = useDiffViewStore(s => s.showTree) && !!toolbar && files.length > 0
  const listRef = useRef<HTMLDivElement>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  /** Expand a file's card and scroll it to the top of the list. */
  const revealFile = useCallback((path: string) => {
    setActivePath(path)
    setFileOpen(path, true)
    // Scroll after the expanded card has rendered
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-diff-path="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: 'start' })
    })
  }, [setFileOpen])

  return (
    <>
      {toolbar
        ? (
            <DiffToolbar
              files={files}
              allOpen={files.length > 0 && files.every(f => openPaths.has(f.path))}
              onToggleAll={open => setOpenPaths(open ? new Set(files.map(f => f.path)) : new Set())}
              onJumpToFile={revealFile}
            />
          )
        : null}
      <div className="flex flex-1 min-h-0">
        {showTree
          ? (
              <TreePane>
                <ChangesTree files={files} root={changesQuery.data?.root} activePath={activePath} onSelect={revealFile} />
              </TreePane>
            )
          : null}
        <div className="flex flex-1 min-w-0 flex-col">
          {changesQuery.isLoading ?
              (
                <div className="flex-1 flex items-center justify-center px-4">
                  <span className="text-sm text-muted-foreground text-center">{t('common.loading')}</span>
                </div>
              ) :
            changesQuery.isError ?
                (
                  <div className="flex-1 flex items-center justify-center px-4">
                    <span className="text-sm text-muted-foreground text-center">
                      {String(changesQuery.error.message || t('diff.loadFailed'))}
                    </span>
                  </div>
                ) :
                !changesQuery.data?.gitRepo ?
                    (
                      <div className="flex-1 flex items-center justify-center px-4">
                        <span className="text-sm text-muted-foreground text-center">
                          {t('diff.notGitRepo')}
                        </span>
                      </div>
                    ) :
                  changesQuery.data?.timedOut ?
                      (
                        <div className="flex-1 flex items-center justify-center px-4">
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 max-w-xs">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                            <span className="text-sm text-amber-700 dark:text-amber-300">
                              {t('diff.timedOut')}
                            </span>
                          </div>
                        </div>
                      ) :
                    files.length === 0 ?
                        (
                          <div className="flex-1 flex items-center justify-center px-4">
                            <span className="text-sm text-muted-foreground text-center">{t('diff.noChanges')}</span>
                          </div>
                        ) :
                        (
                    // The virtualizer renders only the visible lines of each
                    // diff, so expanding many files or switching the view
                    // stays cheap.
                          <WorkerPoolContextProvider {...DIFF_WORKER_POOL}>
                            <Virtualizer
                              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y"
                              contentClassName="p-2"
                            >
                              <div ref={listRef} className="space-y-2">
                                <OversizedFilesBanner files={files} />
                                {files.map(file => (
                                  <DiffFileCard
                                    key={file.path}
                                    projectId={projectId}
                                    issueId={issueId}
                                    path={file.path}
                                    type={file.type}
                                    additions={file.additions}
                                    deletions={file.deletions}
                                    oversized={file.oversized}
                                    sizeDisplay={file.sizeDisplay}
                                    isOpen={openPaths.has(file.path)}
                                    onOpenChange={open => setFileOpen(file.path, open)}
                                  />
                                ))}
                              </div>
                            </Virtualizer>
                          </WorkerPoolContextProvider>
                        )}
        </div>
      </div>
    </>
  )
}

function OversizedFilesBanner({ files }: { files: IssueChangedFile[] }) {
  const { t } = useTranslation()
  const oversizedFiles = useMemo(() => files.filter(f => f.oversized), [files])
  if (oversizedFiles.length === 0) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      <div className="min-w-0 text-[12px] text-amber-700 dark:text-amber-300">
        <p className="font-semibold">{t('diff.oversizedBannerTitle')}</p>
        <ul className="mt-1 space-y-0.5 list-disc list-inside">
          {oversizedFiles.map(f => (
            <li key={f.path} className="truncate">
              <span className="font-mono text-[11px]">{f.path}</span>
              {f.sizeDisplay ? (
                <span className="ml-1 text-amber-600/70 dark:text-amber-400/70">
                  (
                  {f.sizeDisplay}
                  )
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-amber-600/80 dark:text-amber-400/80 text-[11px]">
          {t('diff.oversizedBannerHint')}
        </p>
      </div>
    </div>
  )
}

function DiffToolbar({
  files,
  allOpen,
  onToggleAll,
  onJumpToFile,
}: {
  files: IssueChangedFile[]
  allOpen: boolean
  onToggleAll: (open: boolean) => void
  onJumpToFile: (path: string) => void
}) {
  const showTree = useDiffViewStore(s => s.showTree)
  const toggleTree = useDiffViewStore(s => s.toggleTree)
  const { t } = useTranslation()
  const diffStyle = useDiffViewStore(s => s.diffStyle)
  const setDiffStyle = useDiffViewStore(s => s.setDiffStyle)
  const wrap = useDiffViewStore(s => s.wrap)
  const setWrap = useDiffViewStore(s => s.setWrap)
  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0)
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0)

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 shrink-0">
      <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">
          +
          {additions}
        </span>
        <span className="text-red-600 dark:text-red-400">
          -
          {deletions}
        </span>
      </span>
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('diff.viewOptions')}
            title={t('diff.viewOptions')}
          >
            <Ellipsis className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-0">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('diff.view')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={diffStyle} onValueChange={v => setDiffStyle(v as DiffStyle)}>
                <DropdownMenuRadioItem value="unified" className="whitespace-nowrap text-xs">
                  <Rows2 className="h-3.5 w-3.5" />
                  {t('diff.stacked')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="split" className="whitespace-nowrap text-xs">
                  <Columns2 className="h-3.5 w-3.5" />
                  {t('diff.split')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={setWrap} className="whitespace-nowrap text-xs">
              <WrapText className="h-3.5 w-3.5" />
              {t('diff.wordWrap')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <JumpToFile files={files} onSelect={onJumpToFile} />
        <SidePanelButton
          icon={allOpen ? ChevronsDownUp : ChevronsUpDown}
          label={allOpen ? t('diff.collapseAll') : t('diff.expandAll')}
          onClick={() => onToggleAll(!allOpen)}
        />
        <button
          type="button"
          onClick={toggleTree}
          aria-pressed={showTree}
          aria-label={t('diff.fileTree')}
          title={t('diff.fileTree')}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
            showTree ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <ListTree className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Whether `ref` is near the viewport; tracked only while `enabled`. */
function useNearViewport(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: '400px 0px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      setNear(false)
    }
  }, [ref, enabled])
  return near
}

function JumpToFile({ files, onSelect }: { files: IssueChangedFile[], onSelect: (path: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={t('diff.jumpToFile')}
        title={t('diff.jumpToFile')}
      >
        <FileSearch className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={t('diff.jumpPlaceholder')} className="h-8 text-xs" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="px-3 py-2 text-xs text-muted-foreground">{t('diff.noMatchingFiles')}</CommandEmpty>
            {files.map((file) => {
              const slash = file.path.lastIndexOf('/')
              return (
                <CommandItem
                  key={file.path}
                  value={file.path}
                  onSelect={() => {
                    setOpen(false)
                    onSelect(file.path)
                  }}
                  className="gap-2 text-xs"
                >
                  <span className="shrink-0 font-medium">{file.path.slice(slash + 1)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{file.path.slice(0, Math.max(slash, 0))}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +
                      {file.additions ?? 0}
                    </span>
                    {' '}
                    <span className="text-red-600 dark:text-red-400">
                      -
                      {file.deletions ?? 0}
                    </span>
                  </span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function DiffFileCard({
  projectId,
  issueId,
  path,
  type,
  additions,
  deletions,
  oversized,
  sizeDisplay,
  isOpen,
  onOpenChange,
}: {
  projectId: string
  issueId: string
  path: string
  type: FileType
  additions?: number
  deletions?: number
  oversized?: boolean
  sizeDisplay?: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const diffStyle = useDiffViewStore(s => s.diffStyle)
  const wrap = useDiffViewStore(s => s.wrap)
  const [copied, setCopied] = useState(false)

  // Fetch the patch only once an expanded card nears the viewport, so
  // expand-all does not request every file at once.
  const cardRef = useRef<HTMLDetailsElement>(null)
  const near = useNearViewport(cardRef, isOpen)
  const [seen, setSeen] = useState(false)
  if (near && !seen) setSeen(true)

  const patchQuery = useIssueFilePatch(projectId, issueId, path, isOpen && seen && !oversized)
  const patch = patchQuery.data
  const patchText = patch?.patch ?? ''
  const stats = useMemo(() => getPatchStats(patchText), [patchText])
  const displayAdditions = additions ?? stats.additions
  const displayDeletions = deletions ?? stats.deletions
  const themeType = resolved === 'dark' ? 'dark' : 'light'
  const fullFilePair =
    patch && patch.oldText !== undefined && patch.newText !== undefined ?
        { oldText: patch.oldText, newText: patch.newText } :
      null

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCopyPath = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      void navigator.clipboard
        .writeText(path)
        .then(() => {
          setCopied(true)
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
          copyTimerRef.current = setTimeout(setCopied, 1500, false)
        })
        .catch(() => {})
    },
    [path],
  )

  return (
    <details
      ref={cardRef}
      data-diff-path={path}
      className="group/card rounded-xl border border-border/40 bg-card/60 overflow-hidden transition-all duration-150 open:bg-card open:border-border/50 open:shadow-sm"
      open={isOpen}
      onToggle={e => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="list-none cursor-pointer select-none px-3 py-2.5 transition-colors duration-150 hover:bg-muted/25">
        <div className="flex items-center gap-2">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-open/card:rotate-90" />
          <span className="min-w-0 truncate text-[12.5px] font-medium">{path}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <FileTypeBadge type={type} />
            {oversized
              ? (
                  <span className="shrink-0 text-[10px] font-semibold leading-none text-amber-600 dark:text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded px-1 py-0.5">
                    {sizeDisplay ?? t('diff.oversized')}
                  </span>
                )
              : null}
            <button
              type="button"
              onClick={handleCopyPath}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground hover:bg-muted/40"
              aria-label={t('diff.copyPath')}
              title={t('diff.copyPath')}
            >
              <Copy className={`h-3 w-3 ${copied ? 'text-emerald-500' : ''}`} />
            </button>
            {!oversized
              ? (
                  <span className="flex items-center gap-0.5 text-[11px] font-medium tabular-nums">
                    {displayAdditions > 0 ?
                        (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +
                            {displayAdditions}
                          </span>
                        ) :
                      null}
                    {displayDeletions > 0 ?
                        (
                          <span className="text-red-600 dark:text-red-400">
                            -
                            {displayDeletions}
                          </span>
                        ) :
                      null}
                  </span>
                )
              : null}
          </div>
        </div>
      </summary>
      {isOpen ?
          (
            <div className="min-w-0 border-t border-border/30">
              {oversized ?
                  (
                    <div className="px-3 py-3 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/5">
                      {t('diff.oversizedMessage', { size: sizeDisplay ?? '> 20 MB' })}
                    </div>
                  ) :
                  !seen || patchQuery.isLoading ?
                      (
                        <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                          {t('common.loading')}
                        </div>
                      ) :
                    patchQuery.isError ?
                        (
                          <div className="px-3 py-2.5 text-[11px] text-destructive">
                            {String(patchQuery.error.message || t('diff.loadFailed'))}
                          </div>
                        ) :
                      fullFilePair ?
                          (
                            <div className="overflow-x-auto">
                              <Suspense
                                fallback={(
                                  <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                                    {t('common.loading')}
                                  </div>
                                )}
                              >
                                <LazyMultiFileDiff
                                  oldFile={{ name: path, contents: fullFilePair.oldText }}
                                  newFile={{ name: path, contents: fullFilePair.newText }}
                                  options={{
                                    diffStyle,
                                    diffIndicators: 'bars',
                                    expandUnchanged: false,
                                    hunkSeparators: 'line-info',
                                    disableLineNumbers: false,
                                    overflow: wrap ? 'wrap' : 'scroll',
                                    theme: DIFF_THEME,
                                    themeType,
                                    disableFileHeader: true,
                                  }}
                                />
                              </Suspense>
                            </div>
                          ) :
                        patchText.trim() ?
                            (
                              <PatchDiffView patch={patchText} diffStyle={diffStyle} wrap={wrap} />
                            ) :
                            (
                              <div className="px-3 py-2.5 text-[11px] text-muted-foreground">
                                {t('diff.emptyPatch')}
                              </div>
                            )}
              {patch?.truncated ?
                  (
                    <div className="px-3 pb-2 text-[11px] text-muted-foreground">{t('diff.truncated')}</div>
                  ) :
                null}
            </div>
          ) :
        null}
    </details>
  )
}

function PatchDiffView({ patch, diffStyle, wrap }: { patch: string, diffStyle: DiffStyle, wrap: boolean }) {
  const { resolved } = useTheme()
  const isLikelyPatch = useMemo(
    () => patch.includes('@@') || patch.includes('\ndiff --git '),
    [patch],
  )
  const themeType = resolved === 'dark' ? 'dark' : 'light'

  if (!isLikelyPatch) {
    return (
      <pre className="px-2.5 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
        {patch}
      </pre>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Suspense
        fallback={(
          <pre className="px-2.5 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {patch}
          </pre>
        )}
      >
        <LazyPatchDiff
          patch={patch}
          options={{
            diffStyle,
            diffIndicators: 'bars',
            // A patch carries no unchanged lines beyond its context.
            expandUnchanged: false,
            disableLineNumbers: false,
            overflow: wrap ? 'wrap' : 'scroll',
            theme: DIFF_THEME,
            themeType,
            disableFileHeader: true,
          }}
        />
      </Suspense>
    </div>
  )
}

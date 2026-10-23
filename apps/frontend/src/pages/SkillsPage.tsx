import { cn } from 'cn'
import { ArrowLeft, ChevronRight, Code, Copy, Download, ExternalLink, FileText, ListTree, Lock, Plus, RefreshCw, Save, Search, Trash2, Upload, WrapText } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, isMarkdown } from '@/components/files/FileBrowserContent'
import { FileEditor } from '@/components/files/FileEditor'
import { TreePane } from '@/components/files/TreePane'
import { TreeRow } from '@/components/files/TreeRow'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { InstallSkillDialog, OperationDialog, UninstallSkillDialog, UploadSkillDialog } from '@/components/skills/SkillOperations'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useProjects } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  useCopySkill,
  useCreateSkill,
  useDeleteSkill,
  useSaveSkillFile,
  useSkillFile,
  useSkillFiles,
  useSkills,
  useSkillUpdates,
  useStartSkillsOperation,
} from '@/hooks/use-skills'
import type { PathTreeNode } from '@/lib/path-tree'
import { buildPathTree } from '@/lib/path-tree'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { SkillInfo, SkillUpdateStatus } from '@/types/kanban'

const NO_PROJECT = '__none__'

/** The repository page for a lock-file source URL; only http(s), since the lock file is untrusted input. */
function sourceHref(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl.replace(/\.git$/, ''))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** The skill's folder on GitHub; only for github.com sources (the lock file is untrusted input). */
function githubFolderHref(sourceUrl: string | null, sourcePath: string | null): string | null {
  const repo = sourceHref(sourceUrl)
  if (!repo || new URL(repo).host !== 'github.com') return null
  if (!sourcePath) return repo
  return `${repo.replace(/\/+$/, '')}/tree/HEAD/${sourcePath.split('/').map(encodeURIComponent).join('/')}`
}

function skillKey(skill: Pick<SkillInfo, 'location' | 'name'>): string {
  return `${skill.location}/${skill.name}`
}

export default function SkillsPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { data: projects } = useProjects()
  const [projectId, setProjectId] = useState('')
  const { data, isLoading } = useSkills(projectId || undefined)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'create' | 'copy' | 'delete' | 'install' | 'upload' | 'uninstall' | 'operation' | null>(null)
  const startOperation = useStartSkillsOperation()
  const [operation, setOperation] = useState<{ id: string, title: string }>()
  const cliAvailable = data?.cliAvailable ?? false
  const { data: updatesData } = useSkillUpdates(projectId || undefined)
  const updateStatus = useMemo(
    () => new Map((updatesData?.updates ?? []).map(u => [`${u.location}/${u.name}`, u.status])),
    [updatesData],
  )
  const globalUpdates = (updatesData?.updates ?? []).filter(u => u.status === 'update' && u.location.startsWith('global')).length
  const runUpdate = (names: string[], scope: 'global' | 'project', title: string) => {
    startOperation.mutate(
      { op: 'update', ...(names.length ? { names } : {}), scope, ...(scope === 'project' ? { projectId } : {}) },
      { onSuccess: (op) => {
        setOperation({ id: op.id, title })
        setDialog('operation')
      } },
    )
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const skills = useMemo(() => data?.skills ?? [], [data])
  const term = query.trim().toLowerCase()
  const visible = term
    ? skills.filter(s => s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term))
    : skills
  const groups = [
    { scope: 'global' as const, label: t('skills.global'), items: visible.filter(s => s.scope === 'global') },
    ...(projectId ? [{ scope: 'project' as const, label: t('skills.project'), items: visible.filter(s => s.scope === 'project') }] : []),
  ]
  const selected = skills.find(s => skillKey(s) === selectedKey) ?? null
  const clearSelection = useCallback(() => setSelectedKey(null), [])
  // The uninstalled skill is gone: close its dialog too, or it reopens on the next selection
  const closeUninstalled = useCallback(() => {
    setDialog(null)
    setSelectedKey(null)
  }, [])
  // A small screen shows the list or the open skill, not both
  const showList = !isMobile || !selected
  const showDetail = !isMobile || !!selected
  // The trigger renders the label of the selected item, not its value
  const projectItems = [
    { value: NO_PROJECT, label: t('skills.noProject') },
    ...(projects ?? []).filter(p => p.directory).map(p => ({ value: p.id, label: p.name })),
  ]

  return (
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId="" /> : null}
      <main className="flex flex-1 min-w-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 px-4 py-4 md:px-6">
          {isMobile ? <MobileSidebar activeProjectId="" /> : null}
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">{t('skills.title')}</h1>
          <Badge variant="secondary" className="ml-1">{skills.length}</Badge>
          {/* Below md the actions take their own row instead of overflowing the title row */}
          <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
            <Select items={projectItems} value={projectId || NO_PROJECT} onValueChange={value => setProjectId(!value || value === NO_PROJECT ? '' : value)}>
              <SelectTrigger size="sm" className="w-44" aria-label={t('skills.projectPicker')}>
                <SelectValue placeholder={t('skills.projectPicker')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projectItems.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!cliAvailable || globalUpdates === 0}
              title={cliAvailable ? undefined : t('skills.cliUnavailable')}
              onClick={() => runUpdate([], 'global', t('skills.updateAll'))}
            >
              <RefreshCw className="h-4 w-4" />
              {`${t('skills.updateAll')} (${globalUpdates})`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('upload')}>
              <Upload className="h-4 w-4" />
              {t('skills.upload')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!cliAvailable}
              title={cliAvailable ? undefined : t('skills.cliUnavailable')}
              onClick={() => setDialog('install')}
            >
              <Download className="h-4 w-4" />
              {t('skills.install')}
            </Button>
            <Button size="sm" onClick={() => setDialog('create')}>
              <Plus className="h-4 w-4" />
              {t('skills.newSkill')}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 md:flex-row md:px-6">
          {/* Skill list */}
          {showList
            ? (
                <aside className="flex min-h-0 flex-1 flex-col md:w-80 md:flex-none md:shrink-0">
                  <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder={t('skills.search')}
                      aria-label={t('skills.search')}
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                    {isLoading ? <p className="px-1 text-sm text-muted-foreground">{t('common.loading')}</p> : null}
                    {groups.map(group => (
                      <section key={group.scope}>
                        <button
                          type="button"
                          aria-expanded={!collapsed[group.scope]}
                          onClick={() => setCollapsed(prev => ({ ...prev, [group.scope]: !prev[group.scope] }))}
                          className="mb-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !collapsed[group.scope] && 'rotate-90')} />
                          {group.label}
                          <span className="tabular-nums">
                            (
                            {group.items.length}
                            )
                          </span>
                        </button>
                        {collapsed[group.scope]
                          ? null
                          : (
                              <>
                                {group.items.length === 0 && !isLoading
                                  ? <p className="px-1 py-2 text-xs text-muted-foreground">{group.scope === 'project' ? t('skills.emptyProject') : t('skills.empty')}</p>
                                  : null}
                                <div className="space-y-1">
                                  {group.items.map(skill => (
                                    <SkillRow
                                      key={skillKey(skill)}
                                      skill={skill}
                                      active={skillKey(skill) === selectedKey}
                                      updateStatus={updateStatus.get(skillKey(skill))}
                                      onSelect={() => {
                                        // A dialog belongs to the skill it was opened for
                                        setDialog(null)
                                        setSelectedKey(skillKey(skill))
                                      }}
                                    />
                                  ))}
                                </div>
                              </>
                            )}
                      </section>
                    ))}
                  </div>
                </aside>
              )
            : null}

          {/* Detail */}
          {showDetail
            ? (
                <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border bg-card">
                  {selected
                    ? (
                        <SkillDetail
                          // Same-named project skills of two projects are different files: never share drafts
                          key={selected.scope === 'project' ? `${projectId}:${skillKey(selected)}` : skillKey(selected)}
                          skill={selected}
                          projectId={projectId || undefined}
                          cliAvailable={cliAvailable}
                          updateStatus={updateStatus.get(skillKey(selected))}
                          onCopy={() => setDialog('copy')}
                          onDelete={() => setDialog('delete')}
                          onUpdate={() => runUpdate([selected.name], selected.scope, `${t('skills.update')} ${selected.name}`)}
                          onUninstall={() => setDialog('uninstall')}
                          onBack={isMobile ? clearSelection : undefined}
                        />
                      )
                    : (
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                          {t('skills.selectHint')}
                        </div>
                      )}
                </section>
              )
            : null}
        </div>
      </main>

      <InstallSkillDialog
        open={dialog === 'install'}
        onOpenChange={open => setDialog(open ? 'install' : null)}
        projectId={projectId || undefined}
      />
      <UploadSkillDialog
        open={dialog === 'upload'}
        onOpenChange={open => setDialog(open ? 'upload' : null)}
        projectId={projectId || undefined}
        onUploaded={skill => setSelectedKey(skillKey(skill))}
      />
      <OperationDialog
        open={dialog === 'operation'}
        onOpenChange={open => setDialog(open ? 'operation' : null)}
        title={operation?.title ?? ''}
        operationId={operation?.id}
      />
      <CreateSkillDialog
        open={dialog === 'create'}
        onOpenChange={open => setDialog(open ? 'create' : null)}
        projectId={projectId || undefined}
        onCreated={skill => setSelectedKey(skillKey(skill))}
      />
      {selected
        ? (
            <>
              <CopySkillDialog
                open={dialog === 'copy'}
                onOpenChange={open => setDialog(open ? 'copy' : null)}
                skill={selected}
                projectId={projectId || undefined}
                onCopied={skill => setSelectedKey(skillKey(skill))}
              />
              <DeleteSkillDialog
                open={dialog === 'delete'}
                onOpenChange={open => setDialog(open ? 'delete' : null)}
                skill={selected}
                projectId={projectId || undefined}
                onDeleted={() => setSelectedKey(null)}
              />
              <UninstallSkillDialog
                open={dialog === 'uninstall'}
                onOpenChange={open => setDialog(open ? 'uninstall' : null)}
                skill={selected}
                projectId={projectId || undefined}
                onDone={closeUninstalled}
              />
            </>
          )
        : null}
    </div>
  )
}

function SkillRow({ skill, active, updateStatus, onSelect }: { skill: SkillInfo, active: boolean, updateStatus?: SkillUpdateStatus['status'], onSelect: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-md px-2.5 py-2 text-left transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-accent/60',
      )}
    >
      <div className="flex items-center gap-1.5">
        {skill.managed ? <Lock className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
        <span className="truncate text-sm font-medium">{skill.name}</span>
        <UpdateBadge status={updateStatus} />
        <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
          {skill.managed ? skill.source : skill.agents.length === 1 && skill.agents[0] === 'claude-code' ? t('skills.claudeOnly') : t('skills.local')}
        </span>
      </div>
      {skill.description
        ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>
        : null}
    </button>
  )
}

function UpdateBadge({ status }: { status?: SkillUpdateStatus['status'] }) {
  const { t } = useTranslation()
  if (status === 'update') {
    return <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">{t('skills.updateAvailable')}</span>
  }
  if (status === 'removed') {
    return <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-400">{t('skills.removedFromSource')}</span>
  }
  return null
}

function SkillDetail({ skill, projectId, cliAvailable, updateStatus, onCopy, onDelete, onUpdate, onUninstall, onBack }: {
  skill: SkillInfo
  projectId?: string
  cliAvailable: boolean
  updateStatus?: SkillUpdateStatus['status']
  onCopy: () => void
  onDelete: () => void
  onUpdate: () => void
  onUninstall: () => void
  /** Small screens only: return to the skill list. */
  onBack?: () => void
}) {
  const { t } = useTranslation()
  const { data: files } = useSkillFiles(skill.location, skill.name, projectId)
  const [path, setPath] = useState('SKILL.md')
  const { data: file } = useSkillFile(skill.location, skill.name, path, projectId)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(false)
  // As in the workspace: on a phone the tree and the file take turns at full
  // width. SKILL.md opens first, so a phone starts on the file.
  const isMobile = useIsMobile()
  const [treeOpen, setTreeOpen] = useState(!isMobile)
  const toggleTree = () => setTreeOpen(v => !v)
  const wrap = useFileBrowserStore(s => s.wrap)
  const toggleWrap = useFileBrowserStore(s => s.toggleWrap)
  const save = useSaveSkillFile()
  const content = drafts[path] ?? file?.content ?? ''
  const dirty = drafts[path] !== undefined && drafts[path] !== file?.content

  const handleSave = () => {
    if (skill.managed || !dirty) return
    save.mutate(
      { location: skill.location, name: skill.name, path, content, projectId },
      { onSuccess: () => setDrafts(({ [path]: _, ...rest }) => rest) },
    )
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        {onBack
          ? (
              <Button size="icon-sm" variant="ghost" aria-label={t('skills.backToList')} title={t('skills.backToList')} onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )
          : null}
        <h2 className="text-base font-semibold">{skill.name}</h2>
        <Badge variant={skill.managed ? 'secondary' : 'outline'}>{skill.managed ? t('skills.managed') : t('skills.local')}</Badge>
        {skill.agents.map(agent => (
          <Badge key={agent} variant="outline" className="font-normal">
            {agent === 'claude-code' ? t('skills.agentClaude') : t('skills.agentCodex')}
          </Badge>
        ))}
        {skill.source
          ? sourceHref(skill.sourceUrl)
            ? (
                <a
                  href={sourceHref(skill.sourceUrl)!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {skill.source}
                </a>
              )
            : <span className="text-xs text-muted-foreground">{skill.source}</span>
          : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {githubFolderHref(skill.sourceUrl, skill.sourcePath)
            ? (
                <a
                  href={githubFolderHref(skill.sourceUrl, skill.sourcePath)!}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('skills.openOnGithub')}
                </a>
              )
            : null}
          <Button size="sm" variant="outline" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            {t('skills.copyToLocal')}
          </Button>
          {skill.managed
            ? (
                <>
                  {updateStatus === 'update'
                    ? (
                        <Button size="sm" variant="outline" disabled={!cliAvailable} title={cliAvailable ? undefined : t('skills.cliUnavailable')} onClick={onUpdate}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          {t('skills.update')}
                        </Button>
                      )
                    : null}
                  <Button size="sm" variant="outline" disabled={!cliAvailable} title={cliAvailable ? undefined : t('skills.cliUnavailable')} onClick={onUninstall}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('skills.uninstall')}
                  </Button>
                </>
              )
            : (
                <Button size="sm" variant="outline" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('skills.delete')}
                </Button>
              )}
        </div>
        <p className="basis-full truncate font-mono text-[11px] text-muted-foreground" title={skill.path}>{skill.path}</p>
        {skill.managed
          ? <p className="basis-full text-xs text-amber-600 dark:text-amber-400">{t('skills.readOnly')}</p>
          : null}
        {updateStatus === 'removed'
          ? <p className="basis-full text-xs text-amber-600 dark:text-amber-400">{t('skills.removedNote')}</p>
          : null}
      </header>
      <div className="flex min-h-0 flex-1">
        {treeOpen
          ? (
              <TreePane fill={isMobile}>
                <div className="flex h-full min-h-0 flex-col">
                  {/* The file header (and its toggle) is hidden behind the tree on a phone */}
                  {isMobile
                    ? (
                        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-1.5 min-h-[37px]">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{t('skills.files')}</span>
                          <IconButton icon={ListTree} label={t('fileBrowser.fileTree')} onClick={toggleTree} active />
                        </div>
                      )
                    : null}
                  <nav aria-label={t('skills.files')} className="min-h-0 flex-1 overflow-y-auto p-1.5">
                    <SkillFileTree
                      nodes={buildPathTree((files ?? []).filter(f => f.type === 'file').map(f => f.path))}
                      selected={path}
                      dirty={drafts}
                      onSelect={(next) => {
                        setPath(next)
                        if (isMobile) setTreeOpen(false)
                      }}
                    />
                  </nav>
                </div>
              </TreePane>
            )
          : null}
        <div className={cn('flex min-w-0 flex-1 flex-col', isMobile && treeOpen && 'hidden')}>
          {/* Same header and body as the workspace file browser */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5 min-h-[37px]">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={path}>{path}</span>
            <div className="flex shrink-0 items-center gap-1">
              {dirty && !skill.managed
                ? (
                    <>
                      <span className="text-xs text-muted-foreground">{t('fileBrowser.modified')}</span>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={save.isPending}
                        className="flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white transition-colors hover:bg-emerald-600/90 disabled:opacity-60"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {save.isPending ? t('fileBrowser.saving') : t('fileBrowser.saveFile')}
                      </button>
                    </>
                  )
                : null}
              {isMarkdown(path)
                ? (
                    <IconButton
                      icon={preview ? Code : FileText}
                      label={preview ? t('fileBrowser.viewSource') : t('fileBrowser.viewRendered')}
                      onClick={() => setPreview(p => !p)}
                    />
                  )
                : null}
              <IconButton icon={WrapText} label={t('fileBrowser.wordWrap')} onClick={toggleWrap} active={wrap} />
              <IconButton icon={ListTree} label={t('fileBrowser.fileTree')} onClick={toggleTree} active={treeOpen} />
            </div>
          </div>
          {file
            ? (
                <FileEditor
                  file={{
                    path,
                    type: 'file',
                    content: file.content,
                    size: file.content.length,
                    isTruncated: false,
                    isBinary: file.binary,
                    modifiedAt: '',
                  }}
                  value={content}
                  onChange={value => setDrafts(prev => ({ ...prev, [path]: value }))}
                  onSave={handleSave}
                  wrap={wrap}
                  preview={preview && isMarkdown(path)}
                  readOnly={skill.managed}
                />
              )
            : null}
        </div>
      </div>
    </>
  )
}

/** Folder tree of a skill's files; folders start expanded (skills are small). */
function SkillFileTree({ nodes, selected, dirty, onSelect, depth = 0 }: {
  nodes: PathTreeNode[]
  selected: string
  dirty: Record<string, string>
  onSelect: (path: string) => void
  depth?: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return (
    <>
      {nodes.map(node => node.children
        ? (
            <div key={node.path}>
              <TreeRow
                depth={depth}
                name={node.name}
                title={node.path}
                isDir
                expanded={!collapsed[node.path]}
                onClick={() => setCollapsed(prev => ({ ...prev, [node.path]: !prev[node.path] }))}
              />
              {!collapsed[node.path]
                ? <SkillFileTree nodes={node.children} selected={selected} dirty={dirty} onSelect={onSelect} depth={depth + 1} />
                : null}
            </div>
          )
        : (
            <TreeRow
              key={node.path}
              depth={depth}
              name={node.name}
              title={node.path}
              isDir={false}
              selected={node.path === selected}
              trailing={dirty[node.path] !== undefined ? <span className="text-primary">•</span> : undefined}
              onClick={() => onSelect(node.path)}
            />
          ))}
    </>
  )
}

function CreateSkillDialog({ open, onOpenChange, projectId, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  onCreated: (skill: SkillInfo) => void
}) {
  const { t } = useTranslation()
  const create = useCreateSkill()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const effectiveScope = projectId ? scope : 'global'

  const submit = () => {
    create.mutate(
      { scope: effectiveScope, name: name.trim(), description: description.trim(), ...(effectiveScope === 'project' ? { projectId } : {}) },
      {
        onSuccess: (skill) => {
          onCreated(skill)
          setName('')
          setDescription('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        create.reset(); onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('skills.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault(); submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">{t('skills.name')}</Label>
            <Input id="skill-name" value={name} onChange={e => setName(e.target.value)} placeholder="my-skill" />
            <p className="text-xs text-muted-foreground">{t('skills.nameHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-description">{t('skills.description')}</Label>
            <Textarea id="skill-description" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
          {projectId
            ? (
                <div className="space-y-1.5">
                  <Label>{t('skills.scope')}</Label>
                  <div className="flex gap-3 text-sm">
                    {(['global', 'project'] as const).map(value => (
                      <label key={value} className="flex items-center gap-1.5">
                        <input type="radio" name="skill-scope" checked={scope === value} onChange={() => setScope(value)} />
                        {value === 'global' ? t('skills.scopeGlobal') : t('skills.scopeProject')}
                      </label>
                    ))}
                  </div>
                </div>
              )
            : null}
          {create.error ? <p className="text-sm text-destructive">{create.error.message}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!name.trim() || !description.trim() || create.isPending}>{t('skills.create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CopySkillDialog({ open, onOpenChange, skill, projectId, onCopied }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillInfo
  projectId?: string
  onCopied: (skill: SkillInfo) => void
}) {
  const { t } = useTranslation()
  const copy = useCopySkill()
  const [name, setName] = useState('')

  const submit = () => {
    copy.mutate(
      { location: skill.location, name: skill.name, newName: name.trim(), projectId },
      {
        onSuccess: (created) => {
          onCopied(created)
          setName('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        copy.reset(); onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('skills.copyTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault(); submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="skill-copy-name">{t('skills.name')}</Label>
            <Input id="skill-copy-name" value={name} onChange={e => setName(e.target.value)} placeholder={`${skill.name}-local`} />
            <p className="text-xs text-muted-foreground">{t('skills.nameHint')}</p>
          </div>
          {copy.error ? <p className="text-sm text-destructive">{copy.error.message}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!name.trim() || copy.isPending}>{t('skills.copy')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSkillDialog({ open, onOpenChange, skill, projectId, onDeleted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillInfo
  projectId?: string
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const remove = useDeleteSkill()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('skills.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('skills.deleteConfirm', { name: skill.name, trash: 'data/trash/skills' })}</AlertDialogDescription>
          <AlertDialogDescription>{t('skills.referencesNote')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => remove.mutate(
              { location: skill.location, name: skill.name, projectId },
              { onSuccess: () => {
                onDeleted(); onOpenChange(false)
              } },
            )}
          >
            {t('skills.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

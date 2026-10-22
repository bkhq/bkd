import { cn } from 'cn'
import { Copy, FileText, Lock, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { CodeEditor } from '@/components/files/CodeEditor'
import { AppSidebar } from '@/components/kanban/AppSidebar'
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
} from '@/hooks/use-skills'
import type { SkillInfo } from '@/types/kanban'

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
  const [dialog, setDialog] = useState<'create' | 'copy' | 'delete' | null>(null)

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
  // The trigger renders the label of the selected item, not its value
  const projectItems = [
    { value: NO_PROJECT, label: t('skills.noProject') },
    ...(projects ?? []).filter(p => p.directory).map(p => ({ value: p.id, label: p.name })),
  ]

  return (
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId="" /> : null}
      <main className="flex flex-1 min-w-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-4 md:px-6">
          {isMobile ? <MobileSidebar activeProjectId="" /> : null}
          <Link to="/" aria-label={t('sidebar.home')}>
            <AppLogo className="h-8 w-8" />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">{t('skills.title')}</h1>
          <Badge variant="secondary" className="ml-1">{skills.length}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Select items={projectItems} value={projectId || NO_PROJECT} onValueChange={value => setProjectId(!value || value === NO_PROJECT ? '' : value)}>
              <SelectTrigger className="w-44" aria-label={t('skills.projectPicker')}>
                <SelectValue placeholder={t('skills.projectPicker')} />
              </SelectTrigger>
              <SelectContent>
                {projectItems.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setDialog('create')}>
              <Plus className="h-4 w-4" />
              {t('skills.newSkill')}
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 md:flex-row md:px-6">
          {/* Skill list */}
          <aside className="flex min-h-0 flex-col md:w-80 md:shrink-0">
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
                  <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                    {' '}
                    <span className="tabular-nums">
                      (
                      {group.items.length}
                      )
                    </span>
                  </h2>
                  {group.items.length === 0 && !isLoading
                    ? <p className="px-1 py-2 text-xs text-muted-foreground">{group.scope === 'project' ? t('skills.emptyProject') : t('skills.empty')}</p>
                    : null}
                  <div className="space-y-1">
                    {group.items.map(skill => (
                      <SkillRow
                        key={skillKey(skill)}
                        skill={skill}
                        active={skillKey(skill) === selectedKey}
                        onSelect={() => setSelectedKey(skillKey(skill))}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          {/* Detail */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border bg-card">
            {selected
              ? (
                  <SkillDetail
                    key={skillKey(selected)}
                    skill={selected}
                    projectId={projectId || undefined}
                    onCopy={() => setDialog('copy')}
                    onDelete={() => setDialog('delete')}
                  />
                )
              : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {t('skills.selectHint')}
                  </div>
                )}
          </section>
        </div>
      </main>

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
            </>
          )
        : null}
    </div>
  )
}

function SkillRow({ skill, active, onSelect }: { skill: SkillInfo, active: boolean, onSelect: () => void }) {
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

function SkillDetail({ skill, projectId, onCopy, onDelete }: {
  skill: SkillInfo
  projectId?: string
  onCopy: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { data: files } = useSkillFiles(skill.location, skill.name, projectId)
  const [path, setPath] = useState('SKILL.md')
  const { data: file } = useSkillFile(skill.location, skill.name, path, projectId)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
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
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            {t('skills.copyToLocal')}
          </Button>
          {!skill.managed
            ? (
                <Button size="sm" variant="outline" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('skills.delete')}
                </Button>
              )
            : null}
        </div>
        <p className="basis-full truncate font-mono text-[11px] text-muted-foreground" title={skill.path}>{skill.path}</p>
        {skill.managed
          ? <p className="basis-full text-xs text-amber-600 dark:text-amber-400">{t('skills.readOnly')}</p>
          : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('skills.files')} className="w-60 shrink-0 overflow-y-auto border-r py-2">
          {(files ?? []).filter(f => f.type === 'file').map(f => (
            <button
              key={f.path}
              type="button"
              title={f.path}
              onClick={() => setPath(f.path)}
              className={cn(
                'flex w-full items-center gap-1.5 px-3 py-1 text-left font-mono text-xs',
                f.path === path ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {f.path}
                {drafts[f.path] !== undefined ? ' •' : ''}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {!skill.managed
            ? (
                <div className="flex items-center justify-end gap-2 border-b px-3 py-1.5">
                  {dirty ? <span className="text-xs text-muted-foreground">{t('skills.unsaved')}</span> : null}
                  <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
                    {t('skills.save')}
                  </Button>
                </div>
              )
            : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {file?.binary
              ? <p className="p-4 text-sm text-muted-foreground">{t('skills.binary')}</p>
              : (
                  <CodeEditor
                    value={content}
                    filePath={path}
                    readOnly={skill.managed}
                    wrap
                    onChange={value => setDrafts(prev => ({ ...prev, [path]: value }))}
                    onSave={handleSave}
                  />
                )}
          </div>
        </div>
      </div>
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
          <AlertDialogDescription>{t('skills.deleteConfirm', { name: skill.name })}</AlertDialogDescription>
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

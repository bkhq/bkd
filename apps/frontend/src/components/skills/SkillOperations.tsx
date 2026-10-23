import { cn } from 'cn'
import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useCancelSkillsOperation, useSkillsOperation, useStartSkillsOperation, useUploadSkills } from '@/hooks/use-skills'
import type { SkillInfo, SkillsOperation } from '@/types/kanban'

type Agent = 'claude-code' | 'codex'
const AGENTS: { id: Agent, label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
]

/** Status and CLI output of one skills operation. */
export function OperationLog({ operation }: { operation: SkillsOperation | undefined }) {
  const { t } = useTranslation()
  const endRef = useRef<HTMLDivElement>(null)
  const lines = operation?.output.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [lines])
  if (!operation) return null
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          'text-xs font-medium',
          operation.status === 'failed' ? 'text-destructive' : operation.status === 'succeeded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
        )}
      >
        {t(`skills.operation.${operation.status}`)}
        {operation.error ? `: ${operation.error}` : ''}
      </p>
      {operation.output.length > 0
        ? (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {operation.output.join('\n')}
              <div ref={endRef} />
            </pre>
          )
        : null}
    </div>
  )
}

/** Repository → preview its skills → pick skills, scope and agents → install, with the CLI output. */
export function InstallSkillDialog({ open, onOpenChange, projectId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
}) {
  const { t } = useTranslation()
  const start = useStartSkillsOperation()
  const cancel = useCancelSkillsOperation()
  const [source, setSource] = useState('')
  const [previewId, setPreviewId] = useState<string>()
  const [installId, setInstallId] = useState<string>()
  const [picked, setPicked] = useState<string[]>([])
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [agents, setAgents] = useState<Agent[]>(['claude-code', 'codex'])
  const { data: preview } = useSkillsOperation(previewId)
  const { data: install } = useSkillsOperation(installId)
  const running = preview?.status === 'running' || install?.status === 'running'
  const available = preview?.status === 'succeeded' ? (preview.result?.skills ?? []) : []
  const effectiveScope = projectId ? scope : 'global'

  const reset = () => {
    setPreviewId(undefined)
    setInstallId(undefined)
    setPicked([])
    start.reset()
  }

  const runPreview = () => {
    reset()
    start.mutate({ op: 'preview', source: source.trim(), scope: 'global' }, { onSuccess: op => setPreviewId(op.id) })
  }

  const runInstall = () => {
    start.mutate(
      { op: 'add', source: source.trim(), skills: picked, agents, scope: effectiveScope, ...(effectiveScope === 'project' ? { projectId } : {}) },
      { onSuccess: op => setInstallId(op.id) },
    )
  }

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          setSource('')
        }
        onOpenChange(next)
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg" aria-describedby={undefined}>
        <SheetHeader className="border-b border-border/60">
          <SheetTitle>{t('skills.installTitle')}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault(); runPreview()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="skill-source">{t('skills.repository')}</Label>
              <div className="flex gap-2">
                <Input id="skill-source" value={source} onChange={e => setSource(e.target.value)} placeholder="owner/repo" disabled={running} />
                <Button type="submit" variant="outline" disabled={!source.trim() || running}>{t('skills.preview')}</Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('skills.repositoryHint')}</p>
            </div>
          </form>

          {start.error ? <p className="text-sm text-destructive">{start.error.message}</p> : null}
          {preview && preview.status !== 'succeeded' ? <OperationLog operation={preview} /> : null}

          {preview?.status === 'succeeded' && !installId
            ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>{t('skills.pickSkills')}</Label>
                    {available.length === 0
                      ? <p className="text-xs text-muted-foreground">{t('skills.noSkillsInRepo')}</p>
                      : (
                          <div className="space-y-1 rounded-md border p-2">
                            {available.map(s => (
                              <label key={s.name} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-accent/50">
                                <input type="checkbox" className="mt-1" checked={picked.includes(s.name)} onChange={() => setPicked(p => toggle(p, s.name))} aria-label={s.name} />
                                <span className="min-w-0">
                                  <span className="font-medium">{s.name}</span>
                                  {s.description ? <span className="block line-clamp-2 text-xs text-muted-foreground">{s.description}</span> : null}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                  </div>
                  {projectId
                    ? (
                        <div className="space-y-1.5">
                          <Label>{t('skills.scope')}</Label>
                          <div className="flex gap-3 text-sm">
                            {(['global', 'project'] as const).map(value => (
                              <label key={value} className="flex items-center gap-1.5">
                                <input type="radio" name="install-scope" checked={scope === value} onChange={() => setScope(value)} />
                                {value === 'global' ? t('skills.scopeGlobal') : t('skills.scopeProject')}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    : null}
                  <div className="space-y-1.5">
                    <Label>{t('skills.agents')}</Label>
                    <div className="flex gap-3 text-sm">
                      {AGENTS.map(a => (
                        <label key={a.id} className="flex items-center gap-1.5">
                          <input type="checkbox" checked={agents.includes(a.id)} onChange={() => setAgents(list => toggle(list, a.id))} />
                          {a.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )
            : null}

          {install ? <OperationLog operation={install} /> : null}
        </div>

        <SheetFooter className="flex-row justify-end border-t border-border/60">
          {running
            ? (
                <Button type="button" variant="outline" onClick={() => cancel.mutate((install ?? preview)!.id)}>
                  {t('skills.cancelOperation')}
                </Button>
              )
            : (
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('skills.close')}</Button>
              )}
          {preview?.status === 'succeeded' && !installId
            ? (
                <Button type="button" onClick={runInstall} disabled={!picked.length || !agents.length || start.isPending}>
                  {t('skills.installRun')}
                </Button>
              )
            : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Runs one CLI operation (update) and shows its output until it ends. */
export function OperationDialog({ open, onOpenChange, title, operationId }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  operationId: string | undefined
}) {
  const { t } = useTranslation()
  const { data: operation } = useSkillsOperation(operationId)
  const cancel = useCancelSkillsOperation()
  const running = operation?.status === 'running'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <OperationLog operation={operation} />
        <DialogFooter>
          {running && operation
            ? <Button type="button" variant="outline" onClick={() => cancel.mutate(operation.id)}>{t('skills.cancelOperation')}</Button>
            : <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('skills.close')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Confirms an uninstall through the CLI, then shows its output. */
export function UninstallSkillDialog({ open, onOpenChange, skill, projectId, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: SkillInfo
  projectId?: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const start = useStartSkillsOperation()
  const [operationId, setOperationId] = useState<string>()
  const { data: operation } = useSkillsOperation(operationId)
  const finished = operation && operation.status !== 'running'

  useEffect(() => {
    if (operation?.status === 'succeeded') onDone()
  }, [operation?.status, onDone])

  const close = (next: boolean) => {
    if (!next) {
      setOperationId(undefined)
      start.reset()
    }
    onOpenChange(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('skills.uninstallTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('skills.uninstallConfirm', { name: skill.name })}</AlertDialogDescription>
          <AlertDialogDescription>{t('skills.referencesNote')}</AlertDialogDescription>
        </AlertDialogHeader>
        {start.error ? <p className="text-sm text-destructive">{start.error.message}</p> : null}
        <OperationLog operation={operation} />
        <AlertDialogFooter>
          {finished
            ? <AlertDialogCancel>{t('skills.close')}</AlertDialogCancel>
            : (
                <>
                  <AlertDialogCancel disabled={!!operationId}>{t('common.cancel')}</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    disabled={!!operationId || start.isPending}
                    onClick={() => start.mutate(
                      { op: 'remove', names: [skill.name], scope: skill.scope, ...(skill.scope === 'project' ? { projectId } : {}) },
                      { onSuccess: op => setOperationId(op.id) },
                    )}
                  >
                    {t('skills.uninstall')}
                  </Button>
                </>
              )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const UPLOAD_TYPES = /\.(zip|skill|md)$/i

/** Drop or pick a .zip / .skill / .md file; reports what was added and what already existed. */
export function UploadSkillDialog({ open, onOpenChange, projectId, onUploaded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  onUploaded: (skill: SkillInfo) => void
}) {
  const { t } = useTranslation()
  const upload = useUploadSkills()
  const inputRef = useRef<HTMLInputElement>(null)
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState(false)
  const effectiveScope = projectId ? scope : 'global'
  const result = upload.data

  const send = (file: File | undefined) => {
    if (!file) return
    if (!UPLOAD_TYPES.test(file.name)) {
      setRejected(true)
      return
    }
    setRejected(false)
    // Drop the previous result so it is not mistaken for this upload's
    upload.reset()
    upload.mutate(
      { file, scope: effectiveScope, ...(effectiveScope === 'project' ? { projectId } : {}) },
      { onSuccess: (r) => {
        if (r.created[0]) onUploaded(r.created[0])
      } },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          upload.reset()
          setRejected(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('skills.uploadTitle')}</DialogTitle>
        </DialogHeader>
        {projectId
          ? (
              <div className="flex gap-3 text-sm">
                {(['global', 'project'] as const).map(value => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input type="radio" name="upload-scope" checked={scope === value} onChange={() => setScope(value)} />
                    {value === 'global' ? t('skills.scopeGlobal') : t('skills.scopeProject')}
                  </label>
                ))}
              </div>
            )
          : null}
        <button
          type="button"
          data-testid="skill-dropzone"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            send(e.dataTransfer.files[0])
          }}
          className={cn(
            'flex h-44 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30',
          )}
        >
          <Upload className="h-6 w-6" />
          <span>{upload.isPending ? t('skills.uploading') : t('skills.dropHint')}</span>
          <span className="text-xs">{t('skills.browse')}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.skill,.md"
          className="hidden"
          onChange={(e) => {
            send(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {rejected ? <p className="text-sm text-destructive">{t('skills.unsupportedFile')}</p> : null}
        {upload.error ? <p className="text-sm text-destructive">{upload.error.message}</p> : null}
        {result
          ? (
              <div className="space-y-1 text-sm">
                {result.created.length
                  ? <p className="text-emerald-600 dark:text-emerald-400">{t('skills.uploaded', { names: result.created.map(s => s.name).join(', ') })}</p>
                  : null}
                {result.conflicts.length
                  ? <p className="text-amber-600 dark:text-amber-400">{t('skills.uploadConflicts', { names: result.conflicts.join(', ') })}</p>
                  : null}
                {result.skipped.map(s => (
                  <p key={s.path} className="text-muted-foreground">{t('skills.uploadSkipped', { path: s.path, reason: s.reason })}</p>
                ))}
              </div>
            )
          : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('skills.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

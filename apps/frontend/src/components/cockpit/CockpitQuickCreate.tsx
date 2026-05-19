import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { queryKeys, useProjects } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { kanbanApi } from '@/lib/kanban-api'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { IssueTemplateSelect } from './IssueTemplateSelect'
import type { IssueTemplate } from './IssueTemplateSelect'

export function CockpitQuickCreate() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { data: projects } = useProjects()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templatePrefix, setTemplatePrefix] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const create = useMutation({
    mutationFn: ({ pid, t: titleArg }: { pid: string, t: string }) =>
      kanbanApi.createIssue(pid, {
        title: templatePrefix ? `${templatePrefix}${titleArg}` : titleArg,
        statusId: 'todo',
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues(vars.pid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.issueStats() })
      queryClient.invalidateQueries({ queryKey: ['issues', 'review'] })
      setTitle('')
      setTemplateId('')
      setTemplatePrefix('')
      setOpen(false)
    },
  })

  const handleTemplate = (tpl: IssueTemplate | null) => {
    if (!tpl) {
      setTemplateId('')
      setTemplatePrefix('')
      return
    }
    setTemplateId(tpl.id)
    setTemplatePrefix(tpl.promptPrefix ?? '')
    if (!title.trim() && tpl.titlePattern) setTitle(tpl.titlePattern)
  }

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(projects[0].id)
    }
  }, [projects, projectId])

  // ⌘N shortcut (desktop only — mobile has no keyboard anyway, also avoids
  // hijacking platform shortcuts that don't apply)
  useEffect(() => {
    if (isMobile) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMobile])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => titleRef.current?.focus())
    }
  }, [open])

  // Desktop click-outside (mobile uses Sheet backdrop)
  useEffect(() => {
    if (!open || isMobile) return
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, isMobile])

  const submit = () => {
    if (!projectId || !title.trim()) return
    create.mutate({ pid: projectId, t: title.trim() })
  }

  const form = (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {t('cockpit.quickCreate.template', 'Template')}
      </label>
      <IssueTemplateSelect value={templateId} onChange={handleTemplate} />

      <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {t('cockpit.quickCreate.project', 'Project')}
      </label>
      <select
        value={projectId}
        onChange={e => setProjectId(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2.5 md:py-1.5 text-sm min-h-[44px] md:min-h-0"
      >
        {projects?.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <label className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mt-1">
        {t('cockpit.quickCreate.titleLabel', 'Title')}
      </label>
      <input
        ref={titleRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
        placeholder={t('cockpit.quickCreate.placeholder', 'What to do…')}
        className="w-full rounded-md border border-border bg-background px-3 py-2.5 md:py-1.5 text-sm outline-none focus:border-primary min-h-[44px] md:min-h-0"
      />

      <div className="flex justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 md:py-1 text-xs text-muted-foreground hover:bg-accent cursor-pointer min-h-[40px] md:min-h-0"
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!projectId || !title.trim() || create.isPending}
          className="rounded-md bg-primary px-3 py-2 md:py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer min-h-[40px] md:min-h-0"
        >
          {create.isPending ? t('common.loading', '…') : t('cockpit.quickCreate.submit', 'Create')}
        </button>
      </div>
    </div>
  )

  const trigger = (
    <button
      type="button"
      data-testid="cockpit-quick-create-trigger"
      onClick={() => setOpen(o => !o)}
      className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 md:px-2.5 md:py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer min-h-[40px] md:min-h-0"
      title={isMobile ? t('cockpit.quickCreate.button', 'New') : t('cockpit.quickCreate.title', 'Quick create (⌘N)')}
    >
      <Plus className="h-3.5 w-3.5" />
      <span>{t('cockpit.quickCreate.button', 'New')}</span>
    </button>
  )

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            data-testid="cockpit-quick-create-sheet"
            side="bottom"
            className="max-h-[85vh] p-4"
          >
            <SheetHeader className="p-0 mb-2">
              <SheetTitle>{t('cockpit.quickCreate.title', 'Quick create')}</SheetTitle>
            </SheetHeader>
            {form}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <div ref={popoverRef} className="relative inline-block">
      {trigger}
      {open ?
          (
            <div
              data-testid="cockpit-quick-create-popover"
              className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-border bg-popover shadow-lg p-3"
            >
              {form}
            </div>
          ) :
        null}
    </div>
  )
}

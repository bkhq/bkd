import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useIssueChanges } from '@/hooks/use-kanban'

export function DoneDiffHover({
  projectId,
  issueId,
  children,
}: {
  projectId: string
  issueId: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data, isLoading, isError } = useIssueChanges(projectId, issueId, open)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <div
            data-testid={`done-diff-hover-trigger-${issueId}`}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          />
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="w-72 max-h-80 overflow-y-auto p-2"
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        <div className="flex items-center gap-2 px-1 pb-1 border-b border-border/40 mb-1">
          <FileText className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80">
            {t('cockpit.diffHover.title', 'Changes')}
          </span>
          {data ?
              (
                <span className="ml-auto text-[10px] font-mono tabular-nums">
                  <span className="text-emerald-600">
                    +
                    {data.additions}
                  </span>
                  {' '}
                  <span className="text-rose-600">
                    -
                    {data.deletions}
                  </span>
                </span>
              ) :
            null}
        </div>
        {isLoading && !data ?
            (
              <div data-testid="done-diff-hover-loading" className="text-xs text-muted-foreground/60 px-1 py-2">
                {t('common.loading', 'Loading…')}
              </div>
            ) :
          isError ?
              (
                <div className="text-xs text-destructive px-1 py-2">
                  {t('cockpit.diffHover.error', 'Failed to load changes')}
                </div>
              ) :
              !data || data.files.length === 0 ?
                  (
                    <div className="text-xs text-muted-foreground/60 px-1 py-2">
                      {t('cockpit.diffHover.empty', 'No changes detected')}
                    </div>
                  ) :
                  (
                    <ul className="flex flex-col gap-0.5">
                      {data.files.slice(0, 30).map(f => (
                        <li
                          key={f.path}
                          data-testid={`done-diff-hover-file-${f.path}`}
                          className="flex items-center gap-2 text-xs px-1 py-0.5 rounded hover:bg-accent/40"
                        >
                          <span className="text-[10px] font-mono uppercase text-muted-foreground/60 shrink-0 w-5">
                            {f.type ?? '?'}
                          </span>
                          <span className="truncate font-mono text-foreground/90">{f.path}</span>
                          {f.additions != null || f.deletions != null ?
                              (
                                <span className="ml-auto text-[10px] font-mono tabular-nums shrink-0">
                                  <span className="text-emerald-600">
                                    +
                                    {f.additions ?? 0}
                                  </span>
                                  {' '}
                                  <span className="text-rose-600">
                                    -
                                    {f.deletions ?? 0}
                                  </span>
                                </span>
                              ) :
                            null}
                        </li>
                      ))}
                      {data.files.length > 30 ?
                          (
                            <li className="text-[10px] text-muted-foreground/60 px-1 pt-1">
                              {t('cockpit.diffHover.more', '… + {{n}} more', { n: data.files.length - 30 })}
                            </li>
                          ) :
                        null}
                    </ul>
                  )}
      </PopoverContent>
    </Popover>
  )
}

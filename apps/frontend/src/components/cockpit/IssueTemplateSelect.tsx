import { LayoutTemplate } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIssueTemplates } from '@/hooks/use-issue-templates'

export interface IssueTemplate {
  id: string
  name: string
  source: 'builtin' | 'user'
  titlePattern?: string
  promptPrefix?: string
  defaultStatusId?: 'todo' | 'working' | 'review' | 'done'
  defaultTags?: string[]
}

export function IssueTemplateSelect({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (next: IssueTemplate | null) => void
  className?: string
}) {
  const { t } = useTranslation()
  const { data } = useIssueTemplates()

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
      <select
        data-testid="issue-template-select"
        value={value}
        onChange={(e) => {
          const id = e.target.value
          if (!id) {
            onChange(null)
            return
          }
          const tpl = data?.find(t => t.id === id) ?? null
          onChange(tpl)
        }}
        className="flex-1 rounded-md border border-border bg-background px-2 py-2 md:py-1 text-xs min-h-[40px] md:min-h-0 outline-none focus:border-primary"
      >
        <option value="">{t('issueTemplate.none', 'No template')}</option>
        {data?.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.source === 'user' ? ' ★' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

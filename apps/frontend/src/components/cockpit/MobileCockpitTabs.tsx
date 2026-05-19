import { useTranslation } from 'react-i18next'

export type CockpitMobileMode = 'list' | 'cockpit'

export function MobileCockpitTabs({
  mode,
  onChange,
}: {
  mode: CockpitMobileMode
  onChange: (next: CockpitMobileMode) => void
}) {
  const { t } = useTranslation()
  const options: Array<{ value: CockpitMobileMode, label: string }> = [
    { value: 'list', label: t('review.title', 'Review') },
    { value: 'cockpit', label: t('cockpit.title', 'Cockpit') },
  ]
  return (
    <div
      data-testid="cockpit-mobile-tabs"
      className="flex items-center gap-1 rounded-lg border border-border/60 bg-background p-0.5"
      role="tablist"
    >
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={mode === opt.value}
          data-testid={`cockpit-mobile-tab-${opt.value}`}
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors min-h-[40px] ${
            mode === opt.value ?
              'bg-primary text-primary-foreground shadow-sm' :
              'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

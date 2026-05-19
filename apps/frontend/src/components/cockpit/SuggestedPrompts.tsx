import { useTranslation } from 'react-i18next'

export function SuggestedPrompts({ onSelect }: { onSelect: (prompt: string) => void }) {
  const { t } = useTranslation()
  const suggestions = [
    t('cockpit.assistant.suggest.stuck', 'What\'s stuck right now?'),
    t('cockpit.assistant.suggest.failed', 'Show me failed sessions today'),
    t('cockpit.assistant.suggest.progress', 'Summarize progress across all projects'),
    t('cockpit.assistant.suggest.review', 'Which issues are waiting for review?'),
    t('cockpit.assistant.suggest.create', 'Create a bug-fix issue in <project> to …'),
  ]
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {t('cockpit.assistant.suggest.title', 'Try asking')}
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((prompt, i) => (
          <button
            key={i}
            type="button"
            data-testid={`cockpit-suggested-chip-${i}`}
            onClick={() => onSelect(prompt)}
            className="rounded-full border border-border/60 bg-background px-3 py-2 md:py-1.5 text-xs text-foreground/80 hover:bg-accent hover:text-foreground active:bg-accent/80 transition-colors cursor-pointer min-h-[40px] md:min-h-0 text-left"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

import { Bot } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantPanel } from './AssistantPanel'

export function AssistantFab() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        data-testid="cockpit-assistant-fab"
        onClick={() => setOpen(true)}
        aria-label={t('cockpit.assistant.open', 'Open AI assistant')}
        className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-all cursor-pointer"
      >
        <Bot className="h-5 w-5" />
      </button>
      <AssistantPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}

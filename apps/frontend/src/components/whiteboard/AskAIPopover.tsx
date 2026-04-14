import { BookOpen, Lightbulb, MessageSquare, Search, Sparkles, Zap } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type AskAction = 'explore' | 'explain' | 'simplify' | 'examples' | 'custom'

interface AskAIPopoverProps {
  nodeId: string
  isLoading: boolean
  onAsk: (nodeId: string, action: AskAction, prompt?: string) => void
}

export function AskAIPopover({ nodeId, isLoading, onAsk }: AskAIPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')

  const handleAction = useCallback((action: AskAction) => {
    onAsk(nodeId, action)
    setOpen(false)
  }, [nodeId, onAsk])

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return
    onAsk(nodeId, 'custom', customPrompt.trim())
    setCustomPrompt('')
    setOpen(false)
  }, [nodeId, customPrompt, onAsk])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCustomSubmit()
    }
  }, [handleCustomSubmit])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-primary hover:bg-accent hover:text-primary disabled:opacity-50"
        disabled={isLoading}
        title={t('whiteboard.askAI')}
      >
        {isLoading
          ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          : <Sparkles className="h-3.5 w-3.5" />}
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        side="right"
        align="start"
      >
        <div className="p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {t('whiteboard.quickActions')}
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent text-left"
              onClick={() => handleAction('explore')}
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {t('whiteboard.actionExplore')}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent text-left"
              onClick={() => handleAction('explain')}
            >
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {t('whiteboard.actionExplain')}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent text-left"
              onClick={() => handleAction('simplify')}
            >
              <Zap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {t('whiteboard.actionSimplify')}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent text-left"
              onClick={() => handleAction('examples')}
            >
              <Lightbulb className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {t('whiteboard.actionExamples')}
            </button>
          </div>
        </div>
        <div className="border-t px-3 py-2.5">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={t('whiteboard.askPlaceholder')}
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

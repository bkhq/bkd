import { MessageSquare, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface AskAIPopoverProps {
  nodeId: string
  nodeLabel?: string
  parentLabel?: string
  childLabels?: string[]
  isLoading: boolean
  onAsk: (nodeId: string, prompt: string) => void
}

/** Generate up to 3 heuristic follow-up questions from node context using i18n. */
function buildSuggestedQuestions(
  t: (key: string, opts?: Record<string, string>) => string,
  nodeLabel: string,
  parentLabel: string | undefined,
  childLabels: string[],
): string[] {
  const questions: string[] = []
  const label = nodeLabel || t('whiteboard.untitled')

  if (childLabels.length > 0) {
    questions.push(t('whiteboard.questionRelate', { child: childLabels[0]!, label }))
    if (childLabels.length > 1) {
      questions.push(t('whiteboard.questionDetails', { child: childLabels[1]! }))
    }
  }
  if (parentLabel) {
    questions.push(t('whiteboard.questionExpandContext', { label, parent: parentLabel }))
  } else {
    questions.push(t('whiteboard.questionExpand', { label }))
  }

  return questions.slice(0, 3)
}

export function AskAIPopover({
  nodeId,
  nodeLabel = '',
  parentLabel,
  childLabels = [],
  isLoading,
  onAsk,
}: AskAIPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')

  const suggestedQuestions = useMemo(
    () => buildSuggestedQuestions(t, nodeLabel, parentLabel, childLabels),
    [t, nodeLabel, parentLabel, childLabels],
  )

  const handleSubmit = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAsk(nodeId, trimmed)
    setPrompt('')
    setOpen(false)
  }, [nodeId, onAsk])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit(prompt)
    }
  }, [handleSubmit, prompt])

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
        className="w-80 p-0"
        side="right"
        align="start"
      >
        <div className="px-3 py-2.5 border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={t('whiteboard.askPlaceholder')}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>

        {suggestedQuestions.length > 0 && (
          <div className="p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t('whiteboard.suggestedQuestions')}
            </p>
            <div className="flex flex-col gap-1">
              {suggestedQuestions.map(q => (
                <button
                  key={q}
                  type="button"
                  className="rounded-md px-2.5 py-1.5 text-xs text-left hover:bg-accent text-muted-foreground hover:text-foreground leading-snug"
                  onClick={() => handleSubmit(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

import { Brain } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * "AI is thinking…" indicator with two render modes that the parent
 * (ChatBody) swaps between based on the user's scroll position:
 *
 *   variant='inline'    Pulsing-dots ticker rendered at the bottom of the
 *                       message list. Used while the user is at the bottom.
 *
 *   variant='floating'  Compact pill floating at the top of the chat.
 *                       Used when the user has scrolled up to read history.
 *
 * ChatBody ensures at most one variant is mounted at any time.
 */
export function ThinkingHover({
  isActive,
  workingStep,
  isCancelling = false,
  onCancel,
  variant = 'floating',
}: {
  /** True while the session is `running` or `pending`. */
  isActive: boolean
  /** Current tool / step the engine is on (e.g. "Reading src/foo.ts"). */
  workingStep?: string | null
  isCancelling?: boolean
  onCancel?: () => void
  /** 'inline' = bottom-of-list ticker; 'floating' = top overlay pill. */
  variant?: 'inline' | 'floating'
}) {
  const { t } = useTranslation()
  const [, force] = useState(0)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isActive) {
      startedAtRef.current = null
      return
    }
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now()
    }
    const id = setInterval(() => force(n => n + 1), 500)
    return () => clearInterval(id)
  }, [isActive])

  if (!isActive) return null

  const elapsedMs = Date.now() - (startedAtRef.current ?? Date.now())
  const sec = Math.floor(elapsedMs / 1000)
  const elapsedText = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2.5 my-2 px-3 py-2 text-xs text-muted-foreground animate-message-enter">
        <span className="thinking-dots flex items-center gap-[3px] text-violet-500/70 dark:text-violet-400/70">
          <span />
          <span />
          <span />
        </span>
        <span className="font-medium text-violet-500/80 dark:text-violet-400/80">
          {isCancelling ? t('session.cancelling') : t('session.thinking')}
        </span>
        <span className="font-mono tabular-nums text-[11px] text-violet-500/60 dark:text-violet-300/50">
          {elapsedText}
        </span>
        {!isCancelling && workingStep ?
            (
              <span className="truncate text-[11px] text-muted-foreground/60 italic">
                {workingStep}
              </span>
            ) :
          null}
        {onCancel ?
            (
              <button
                type="button"
                onClick={onCancel}
                disabled={isCancelling}
                className="ml-auto shrink-0 rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
              </button>
            ) :
          null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-violet-300/30 dark:border-violet-500/20 bg-background/85 backdrop-blur-md shadow-sm px-3 py-2 text-sm">
      <Brain className="h-4 w-4 shrink-0 text-violet-500/80 dark:text-violet-300/80 thinking-pulse" />
      <span className="font-medium text-violet-700/90 dark:text-violet-200/90 shrink-0">
        {isCancelling ? t('session.cancelling') : t('session.thinking')}
      </span>
      <span className="font-mono tabular-nums text-[11px] text-violet-500/60 dark:text-violet-300/50 shrink-0">
        {elapsedText}
      </span>
      {!isCancelling && workingStep ?
          (
            <span className="truncate text-[11px] text-muted-foreground/70 italic min-w-0">
              {workingStep}
            </span>
          ) :
        null}
      {onCancel ?
          (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="ml-auto shrink-0 rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
            </button>
          ) :
        null}
    </div>
  )
}

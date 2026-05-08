import { Brain, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedLogEntry } from '@/types/kanban'

/**
 * "AI is thinking…" indicator with two render modes that the parent
 * (ChatBody) swaps between based on the user's scroll position:
 *
 *   variant='inline'    Pulsing-dots ticker rendered at the bottom of the
 *                       message list (the original location). Used while
 *                       the user is at the bottom watching for the next
 *                       reply, where their visual focus already is.
 *
 *   variant='floating'  Compact pill floating at the top of the chat,
 *                       with a "tap to scroll back" affordance. Used when
 *                       the user has scrolled UP to read history — the
 *                       inline indicator is off-screen, so this surfaces
 *                       the running state without forcing them to scroll.
 *
 * Both modes share the elapsed-time and thinking-preview logic, so the
 * data is identical; only the layout differs. ChatBody is responsible
 * for ensuring at most one variant is mounted at any time so the user
 * never sees two indicators at once.
 */
export function ThinkingHover({
  logs,
  isActive,
  workingStep,
  isCancelling = false,
  onCancel,
  variant = 'floating',
}: {
  logs: NormalizedLogEntry[]
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
  const [expanded, setExpanded] = useState(false)
  const [, force] = useState(0)
  const startedAtRef = useRef<number | null>(null)

  // Find the most recent thinking entry. Iterate from the end since the
  // chat is chronological and we want the newest reasoning chunk.
  const latestThinking = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].entryType === 'thinking') return logs[i]
    }
    return null
  }, [logs])

  // Reset the timer whenever the session transitions from inactive → active,
  // and tick every 500ms so the elapsed counter feels live without burning
  // a full second of latency on each frame. The state-less force-render
  // avoids re-rendering the whole memoized preview block.
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

  // Last ~3 non-empty lines for the collapsed preview. Trim each to keep
  // the bar slim — full text is available on expand.
  const previewLines = (latestThinking?.content ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)
    .slice(-3)

  // Inline mode: simpler ticker matching the original "thinking dots"
  // layout, anchored at the bottom of the message list. No expansion,
  // no preview — used when the user is at the bottom and already sees
  // the latest message + indicator together.
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
    <div
      className="rounded-lg border border-violet-300/30 dark:border-violet-500/20 bg-background/85 backdrop-blur-md shadow-sm"
      data-state={expanded ? 'expanded' : 'collapsed'}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Brain className="h-4 w-4 shrink-0 text-violet-500/80 dark:text-violet-300/80 thinking-pulse" />
          <span className="font-medium text-violet-700/90 dark:text-violet-200/90 shrink-0">
            {isCancelling ? t('session.cancelling') : t('session.thinking')}
          </span>
          {/* Removed: previously showed t('common.loading') ("加载中...") when
              latestThinking was null. That text was wrong — the AI is
              thinking even when no thinking blocks are emitted (Claude
              default). Always show "AI 思考中" while active. */}
          <span className="font-mono tabular-nums text-[11px] text-violet-500/60 dark:text-violet-300/50 shrink-0">
            {elapsedText}
          </span>
          {/* workingStep — what the engine is currently doing (e.g. "Reading
              src/foo.ts"). Truncates instead of wrapping so the bar height
              stays predictable. */}
          {!isCancelling && workingStep ?
              (
                <span className="truncate text-[11px] text-muted-foreground/70 italic">
                  {workingStep}
                </span>
              ) :
            null}
          <ChevronDown
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-violet-500/60 dark:text-violet-300/50 transition-transform duration-150 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
        {onCancel ?
            (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCancel()
                }}
                disabled={isCancelling}
                className="shrink-0 rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
              </button>
            ) :
          null}
      </div>

      {/* Collapsed preview — last 3 lines fading at the top so it feels
          like a live ticker even before the user expands. */}
      {!expanded && previewLines.length > 0
        ? (
            <div
              className="px-3 pb-2 pt-1 text-xs leading-relaxed text-violet-700/70 dark:text-violet-200/60 border-t border-violet-300/15 dark:border-violet-500/10"
              style={{
                maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,1) 30%)',
                WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,1) 30%)',
              }}
            >
              {previewLines.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          )
        : null}

      {/* Expanded full content — bounded so it can't take over the chat
          area; the inner div scrolls. */}
      {expanded && latestThinking
        ? (
            <div className="px-3 pb-2 pt-1 max-h-[40vh] overflow-y-auto text-[12px] leading-relaxed text-violet-700/80 dark:text-violet-200/70 border-t border-violet-300/15 dark:border-violet-500/10 whitespace-pre-wrap">
              {latestThinking.content}
            </div>
          )
        : null}
    </div>
  )
}

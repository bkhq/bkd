import { Brain, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedLogEntry } from '@/types/kanban'

/**
 * Sticky "AI is thinking…" bar that mimics ChatGPT's reasoning indicator.
 *
 * Renders ONLY while the issue is actively running. The collapsed state
 * shows a pulsing brain icon, the elapsed time, and the most recent ~3
 * lines of streaming reasoning so the user can glance at the gist
 * without expanding. Tapping the bar expands the full thinking content
 * (capped to 40vh, scrollable inside).
 *
 * Mounted as `position: sticky; top: 0` inside the chat scroll container
 * so it floats above message content without pushing the conversation
 * layout. When the task settles (`isActive` becomes false) the component
 * unmounts — the historical thinking entries remain inline in the chat
 * stream as collapsed `<details>` blocks (LogEntry handles those).
 */
export function ThinkingHover({
  logs,
  isActive,
}: {
  logs: NormalizedLogEntry[]
  /** True while the session is `running` or `pending`. */
  isActive: boolean
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

  return (
    <div
      className="sticky top-0 z-20 mx-2 mt-2 rounded-lg border border-violet-300/30 dark:border-violet-500/20 bg-violet-500/[0.06] backdrop-blur-md shadow-sm"
      data-state={expanded ? 'expanded' : 'collapsed'}
    >
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left"
      >
        <Brain className="h-4 w-4 shrink-0 text-violet-500/80 dark:text-violet-300/80 thinking-pulse" />
        <span className="font-medium text-violet-700/90 dark:text-violet-200/90">
          {latestThinking ? t('session.thinking') : t('common.loading')}
        </span>
        <span className="font-mono tabular-nums text-[11px] text-violet-500/60 dark:text-violet-300/50">
          {elapsedText}
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-violet-500/60 dark:text-violet-300/50 transition-transform duration-150 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

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

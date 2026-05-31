import type { NormalizedLogEntry, TimelineEntry } from '@bkd/shared'
import { CheckCircle2, Circle, Lightbulb, ListTodo, Loader2 } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import { useViewModeStore } from '@/stores/view-mode-store'
import { LogEntry } from './LogEntry'
import { ToolGroupMessage } from './ToolItems'

const AcpPlanCard = memo(({
  entry,
  todos,
  completedCount,
}: {
  entry: NormalizedLogEntry
  todos: Array<{ content: string, status: string, activeForm?: string }>
  completedCount: number
}) => {
  const { t } = useTranslation()
  const title = entry.content.trim() || 'Plan updated'

  return (
    <div className="animate-message-enter py-1.5">
      <div className="border border-border/60 bg-card/40">
        <div className="flex items-center gap-2 border-b border-border/20 px-3 py-2 text-xs text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="font-medium">{t('session.tool.taskPlan')}</span>
          <span className="text-muted-foreground/50">
            (
            {completedCount}
            /
            {todos.length}
            )
          </span>
          <span className="truncate text-muted-foreground/70">{title}</span>
        </div>
        <div className="space-y-1 px-3 py-2">
          {todos.map((todo, idx) => (
            <div key={`${todo.content}-${idx}`} className="flex items-start gap-1.5 text-xs">
              {todo.status === 'completed' ?
                  (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  ) :
                todo.status === 'in_progress' ?
                    (
                      <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-blue-500" />
                    ) :
                    (
                      <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                    )}
              <span
                className={
                  todo.status === 'completed' ?
                    'text-muted-foreground/60 line-through' :
                    todo.status === 'in_progress' ?
                      'text-blue-600 dark:text-blue-400' :
                      ''
                }
              >
                {todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

/** Real-time streaming thinking block — full content with auto-scroll. */
const StreamingThinking = memo(({ entry }: { entry: NormalizedLogEntry }) => {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entry.content])

  return (
    <div className="my-1">
      <div className="border border-violet-300/20 dark:border-violet-500/15 bg-violet-500/[0.02] dark:bg-violet-500/[0.02] rounded-sm">
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-violet-500/50 dark:text-violet-400/50">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          <span className="font-medium">{t('session.thinking')}</span>
        </div>
        <div className="px-3 pb-2 pt-0.5 border-t border-violet-300/10 dark:border-violet-500/10">
          <pre
            ref={contentRef}
            className="text-xs text-violet-600/50 dark:text-violet-300/40 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto scroll-smooth"
          >
            {entry.content}
          </pre>
        </div>
      </div>
    </div>
  )
})

/**
 * Completed thinking block — expanded by default so switching out of
 *  streaming mode doesn't visually collapse all thinking content.
 */
const CompletedThinking = memo(({ entry }: { entry: NormalizedLogEntry }) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div className="animate-message-enter my-1">
      <div className="bg-violet-500/[0.02] border border-violet-300/15 dark:border-violet-500/10 rounded-sm">
        <button
          type="button"
          onClick={() => setIsOpen(v => !v)}
          className="w-full cursor-pointer px-3 py-1.5 text-xs text-violet-500/50 dark:text-violet-400/50 hover:bg-violet-500/[0.03] transition-colors flex items-center gap-2"
        >
          <Lightbulb className="h-3 w-3 shrink-0" />
          <span className="font-medium">{t('session.thoughtProcess')}</span>
          <span className="ml-auto text-[10px] opacity-50">
            {isOpen ? '收起' : '展开'}
          </span>
        </button>
        {isOpen && (
          <div className="px-3 pb-2 pt-1 border-t border-violet-300/10 dark:border-violet-500/10">
            <pre className="text-xs text-violet-600/50 dark:text-violet-300/40 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto">
              {entry.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
})

export function AcpTimeline({
  logs,
  scrollRef,
  isRunning = false,
  onEditPending,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  logs: TimelineEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  onEditPending?: (messageId: string) => void
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { t } = useTranslation()
  const fullWidthChat = useViewModeStore(s => s.fullWidthChat)
  const { items, pendingMessages } = useAcpTimeline(logs)

  const nearBottomRef = useRef(true)
  useEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const handler = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [scrollRef])

  const initialScrollDone = useRef(false)
  useEffect(() => {
    if (initialScrollDone.current || (items.length === 0 && pendingMessages.length === 0)) return
    const el = scrollRef?.current
    if (!el) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight })
        initialScrollDone.current = true
      })
    })
  }, [items.length, pendingMessages.length, scrollRef])

  const prevLenRef = useRef(items.length)
  const prevFirstIdRef = useRef(items[0]?.id)
  const firstItemId = items[0]?.id

  // Scroll anchoring on prepend — see SessionMessages for the long form.
  // Without this, older items added at the top shift the user's viewport
  // to the new top instead of preserving the message they were reading.
  const prevScrollHeightRef = useRef(0)
  useLayoutEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const wasOlderPrepend =
      initialScrollDone.current &&
      items.length > prevLenRef.current &&
      prevFirstIdRef.current &&
      firstItemId !== prevFirstIdRef.current
    if (wasOlderPrepend && prevScrollHeightRef.current > 0) {
      const delta = el.scrollHeight - prevScrollHeightRef.current
      if (delta > 0) el.scrollTop = el.scrollTop + delta
      requestAnimationFrame(() => {
        const finalDelta = el.scrollHeight - prevScrollHeightRef.current
        if (finalDelta > 0) el.scrollTop = el.scrollTop + (finalDelta - delta)
      })
    }
    prevScrollHeightRef.current = el.scrollHeight
  }, [firstItemId, items.length, scrollRef])

  // Auto-load older logs via IntersectionObserver on a top sentinel.
  const hasOlderLogsRef = useRef(hasOlderLogs)
  const isLoadingOlderRef = useRef(isLoadingOlder)
  useEffect(() => {
    hasOlderLogsRef.current = hasOlderLogs
  }, [hasOlderLogs])
  useEffect(() => {
    isLoadingOlderRef.current = isLoadingOlder
  }, [isLoadingOlder])

  const topSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = topSentinelRef.current
    const root = scrollRef?.current
    if (!sentinel || !root || !onLoadOlder) return
    const trigger = () => {
      if (!hasOlderLogsRef.current || isLoadingOlderRef.current) return
      onLoadOlder()
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        trigger()
      },
      { root, rootMargin: '300px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    // Scroll-based fallback for mobile WebKit: IntersectionObserver can
    // miss the intersection event during fast inertial scrolls. The shared
    // `trigger` guard makes both paths safe to coexist.
    const onScroll = () => {
      if (root.scrollTop <= 300) trigger()
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', onScroll)
    }
    // items.length: sentinel div is gated by a `return null` early-exit
    // (see below) when items=[] && pending=[] && !isRunning. Without
    // re-running on items.length transition 0→N the observer never gets
    // attached after a cold mount — same bug class as SessionMessages.
  }, [scrollRef, onLoadOlder, items.length])

  useEffect(() => {
    if (!initialScrollDone.current) return
    const wasOlderPrepend =
      items.length > prevLenRef.current &&
      prevFirstIdRef.current &&
      firstItemId !== prevFirstIdRef.current

    if (!wasOlderPrepend && nearBottomRef.current && (items.length !== prevLenRef.current || isRunning)) {
      const el = scrollRef?.current
      el?.scrollTo({ top: el.scrollHeight })
    }
    prevLenRef.current = items.length
    prevFirstIdRef.current = firstItemId
  }, [items, isRunning, scrollRef, firstItemId])

  if (items.length === 0 && pendingMessages.length === 0 && !isRunning) return null

  return (
    <div className={`flex flex-col py-1.5 px-4${fullWidthChat ? '' : ' max-w-3xl'}`}>
      {/* Auto-load sentinel — see SessionMessages for context. */}
      <div ref={topSentinelRef} aria-hidden className="h-0 shrink-0" />
      {isLoadingOlder ?
          (
            <div className="flex justify-center py-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('common.loading')}
              </span>
            </div>
          ) :
        null}

      {items.map((item) => {
        switch (item.type) {
          case 'tool-group':
            return (
              <div key={item.id} className="group">
                {item.thinking && (
                  <div className="mb-1.5">
                    <CompletedThinking entry={item.thinking} />
                  </div>
                )}
                <ToolGroupMessage message={item.message} />
              </div>
            )
          case 'plan':
            return (
              <AcpPlanCard
                key={item.id}
                entry={item.entry}
                todos={item.todos}
                completedCount={item.completedCount}
              />
            )
          case 'thinking':
            return item.isStreaming && isRunning ?
                <StreamingThinking key={item.id} entry={item.entry} /> :
                <CompletedThinking key={item.id} entry={item.entry} />
          case 'entry':
            return (
              <div key={item.id} className="group">
                {item.thinking && (
                  <div className="mb-1.5">
                    <CompletedThinking entry={item.thinking} />
                  </div>
                )}
                <LogEntry entry={item.entry} />
              </div>
            )
          default:
            return null
        }
      })}

      {pendingMessages.length > 0 ?
          (
            <div className="mt-1 border-t border-border/30 pt-2">
              {pendingMessages.map((entry, idx) => (
                <div key={entry.messageId ?? `acp-pending-${idx}`} className="group relative">
                  <LogEntry entry={entry} />
                  {onEditPending ?
                      (
                        <button
                          type="button"
                          onClick={() => onEditPending(entry.messageId ?? `acp-pending-${idx}`)}
                          className="absolute right-2 top-2 hidden rounded-md border border-border/40 bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
                        >
                          {t('common.edit')}
                        </button>
                      ) :
                    null}
                </div>
              ))}
            </div>
          ) :
        null}
    </div>
  )
}

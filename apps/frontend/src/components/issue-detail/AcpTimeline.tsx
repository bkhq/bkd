import type { NormalizedLogEntry, TimelineEntry } from '@bkd/shared'
import { CheckCircle2, Circle, Lightbulb, ListTodo, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import { useViewModeStore } from '@/stores/view-mode-store'
import { LogEntry } from './LogEntry'
import { ToolGroupMessage } from './ToolItems'

function AcpPlanCard({
  entry,
  todos,
  completedCount,
}: {
  entry: NormalizedLogEntry
  todos: Array<{ content: string, status: string, activeForm?: string }>
  completedCount: number
}) {
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
}

/** Real-time streaming thinking block — full content with auto-scroll. */
function StreamingThinking({ entry }: { entry: NormalizedLogEntry }) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entry.content])

  return (
    <div className="animate-message-enter my-0.5">
      <div className="border border-violet-300/30 dark:border-violet-500/20 bg-violet-500/[0.04] dark:bg-violet-500/[0.03]">
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-violet-600/80 dark:text-violet-400/70">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          <span className="font-medium">{t('session.thinking')}</span>
        </div>
        <div className="px-3 pb-2 pt-0.5 border-t border-violet-300/15 dark:border-violet-500/10">
          <pre
            ref={contentRef}
            className="text-xs text-violet-600/60 dark:text-violet-300/50 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto"
          >
            {entry.content}
          </pre>
        </div>
      </div>
    </div>
  )
}

/** Completed thinking block — auto-collapsed to one line, click to expand. */
function CompletedThinking({ entry }: { entry: NormalizedLogEntry }) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="animate-message-enter my-0.5">
      <div className="bg-violet-500/[0.03] border border-violet-300/20 dark:border-violet-500/15">
        <button
          type="button"
          onClick={() => setIsOpen(v => !v)}
          className="w-full cursor-pointer px-3 py-1.5 text-xs text-violet-500/60 dark:text-violet-400/60 hover:bg-violet-500/[0.04] transition-colors flex items-center gap-2"
        >
          <Lightbulb className="h-3 w-3 shrink-0" />
          <span className="font-medium">{t('session.thoughtProcess')}</span>
        </button>
        {isOpen && (
          <div className="px-3 pb-2 pt-1 border-t border-violet-300/10 dark:border-violet-500/10">
            <pre className="text-xs text-violet-600/60 dark:text-violet-300/50 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
              {entry.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

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
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150
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

  useEffect(() => {
    if (!initialScrollDone.current) return
    const firstId = items[0]?.id
    const wasOlderPrepend =
      items.length > prevLenRef.current &&
      prevFirstIdRef.current &&
      firstId !== prevFirstIdRef.current

    if (!wasOlderPrepend && nearBottomRef.current && (items.length !== prevLenRef.current || isRunning)) {
      const el = scrollRef?.current
      el?.scrollTo({ top: el.scrollHeight })
    }
    prevLenRef.current = items.length
    prevFirstIdRef.current = firstId
  }, [items, isRunning, scrollRef])

  if (items.length === 0 && pendingMessages.length === 0 && !isRunning) return null

  return (
    <div className={`flex flex-col py-1.5 px-4${fullWidthChat ? '' : ' max-w-3xl'}`}>
      {hasOlderLogs && onLoadOlder ?
          (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={isLoadingOlder}
                className="rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingOlder ? t('common.loading') : t('session.loadMore')}
              </button>
            </div>
          ) :
        null}

      {items.map((item) => {
        switch (item.type) {
          case 'tool-group':
            return <ToolGroupMessage key={item.id} message={item.message} />
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
            return <LogEntry key={item.id} entry={item.entry} />
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

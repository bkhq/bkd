import type { ChatMessage, NormalizedLogEntry, TaskPlanChatMessage } from '@bkd/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, ChevronDown, Circle, ListTodo, Loader2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { useViewModeStore } from '@/stores/view-mode-store'
import { LogEntry } from './LogEntry'
import { ToolGroupMessage } from './ToolItems'

// ── ChatMessage renderer ─────────────────────────────────

const ChatMessageRow = memo(({ message }: { message: ChatMessage }) => {
  switch (message.type) {
    case 'user': {
      if (message.status === 'command') {
        return (
          <div className="group py-1.5 animate-message-enter">
            <details className="rounded-lg border border-border/30 bg-muted/10 transition-all duration-200 open:bg-muted/20">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:bg-muted/20 transition-colors">
                <code className="font-mono text-foreground/70">{message.entry.content}</code>
              </summary>
              {message.commandOutput ?
                  (
                    <div className="px-3 pb-3 pt-1.5 border-t border-border/20">
                      <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                        {message.commandOutput.content}
                      </pre>
                    </div>
                  ) :
                null}
            </details>
          </div>
        )
      }
      return <LogEntry entry={message.entry} />
    }

    case 'assistant':
      return <LogEntry entry={message.entry} durationMs={message.durationMs} />

    case 'tool-group':
      return <ToolGroupMessage message={message} />

    case 'task-plan':
      return <TaskPlanMessage message={message as TaskPlanChatMessage} />

    case 'thinking':
    case 'system':
    case 'error':
      return <LogEntry entry={message.entry} />

    default:
      return null
  }
}, ({ message: previous }, { message: next }) => {
  if (previous === next) return true
  if (previous.type !== next.type || previous.id !== next.id) return false
  // Grouped tools derive state from multiple entries; let those updates through.
  if (previous.type === 'tool-group' || next.type === 'tool-group') return false
  if (previous.entry !== next.entry) return false
  if (previous.type === 'assistant' && next.type === 'assistant') {
    return previous.durationMs === next.durationMs
  }
  if (previous.type === 'user' && next.type === 'user') {
    return previous.commandOutput === next.commandOutput
  }
  return true
})

// ── Task Plan ────────────────────────────────────────────

function TaskPlanMessage({ message }: { message: TaskPlanChatMessage }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const { todos, completedCount } = message

  const inProgressItem = todos.find(it => it.status === 'in_progress')
  const statusText = inProgressItem ? inProgressItem.activeForm || inProgressItem.content : null

  return (
    <div className="animate-message-enter">
      <div className="border border-border/60 bg-background/95">
        {/* Compact status bar */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted/20"
        >
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="font-medium text-muted-foreground">{t('session.tool.taskPlan')}</span>
          <span className="text-muted-foreground/50">
            (
            {completedCount}
            /
            {todos.length}
            )
          </span>
          {statusText ?
              (
                <span className="truncate text-blue-600 dark:text-blue-400">{statusText}</span>
              ) :
            null}
          <ChevronDown
            className={`ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Expandable detail panel — opens downward */}
        {expanded ?
            (
              <div className="px-3 pb-2 pt-1 space-y-0.5 border-t border-border/20">
                {todos.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-xs">
                    {item.status === 'completed' ?
                        (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
                        ) :
                      item.status === 'in_progress' ?
                          (
                            <Loader2 className="h-3 w-3 shrink-0 text-blue-500 animate-spin mt-0.5" />
                          ) :
                          (
                            <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40 mt-0.5" />
                          )}
                    <span
                      className={
                        item.status === 'completed' ?
                          'text-muted-foreground/60 line-through' :
                          item.status === 'in_progress' ?
                            'text-blue-600 dark:text-blue-400' :
                            ''
                      }
                    >
                      {item.status === 'in_progress' ? item.activeForm || item.content : item.content}
                    </span>
                  </div>
                ))}
              </div>
            ) :
          null}
      </div>
    </div>
  )
}

// ── SessionMessages (main export) ────────────────────────

export function SessionMessages({ sessionKey, ...props }: {
  sessionKey?: string
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  return <LegacySessionMessages key={sessionKey} {...props} />
}

/** Threshold: below this count, render without virtualization for simpler layout. */
const VIRTUALIZE_THRESHOLD = 80

function LegacySessionMessages({
  logs,
  scrollRef,
  isRunning = false,
  workingStep,
  onCancel,
  isCancelling = false,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { t } = useTranslation()
  const fullWidthChat = useViewModeStore(s => s.fullWidthChat)

  // Transform flat entries → grouped ChatMessage[]
  const { messages } = useChatMessages(logs)

  const useVirtual = messages.length >= VIRTUALIZE_THRESHOLD

  const contentRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const scrollFrameRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const scheduleFollow = useCallback(() => {
    if (scrollFrameRef.current) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0
      const el = scrollRef?.current
      if (!el || !nearBottomRef.current) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
      }
      lastScrollTopRef.current = el.scrollTop
    })
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef?.current
    const content = contentRef.current
    if (!el || !content) return
    const previousAnchor = el.style.overflowAnchor
    el.style.overflowAnchor = 'none'
    lastScrollTopRef.current = el.scrollTop
    const handler = () => {
      const top = el.scrollTop
      const gap = el.scrollHeight - top - el.clientHeight
      if (top < lastScrollTopRef.current && gap > 1) {
        nearBottomRef.current = false
      } else if (gap < 150) {
        nearBottomRef.current = true
      }
      lastScrollTopRef.current = top
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) nearBottomRef.current = false
    }
    const observer = new ResizeObserver(scheduleFollow)
    observer.observe(content)
    observer.observe(el)
    el.addEventListener('scroll', handler, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    scheduleFollow()
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', handler)
      el.removeEventListener('wheel', onWheel)
      el.style.overflowAnchor = previousAnchor
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = 0
    }
  }, [scrollRef, scheduleFollow])

  useLayoutEffect(() => {
    scheduleFollow()
  }, [messages, isRunning, scheduleFollow])

  return (
    <div ref={contentRef} className={`flex flex-col py-2 px-5${fullWidthChat ? '' : ' max-w-4xl'}`}>
      {hasOlderLogs && onLoadOlder ?
          (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={() => {
                  nearBottomRef.current = false
                  onLoadOlder()
                }}
                disabled={isLoadingOlder}
                className="rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingOlder ? t('common.loading') : t('session.loadMore')}
              </button>
            </div>
          ) :
        null}
      <VirtualMessageList
        messages={messages}
        scrollRef={scrollRef}
        virtualize={useVirtual}
      />
      <ThinkingIndicator
        isRunning={isRunning}
        isCancelling={isCancelling}
        workingStep={workingStep}
        onCancel={onCancel}
      />
    </div>
  )
}

// ── Virtualized message list ─────────────────────────────

function VirtualMessageList({
  messages,
  scrollRef,
  virtualize,
}: {
  messages: ChatMessage[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  virtualize: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState<number | null>(null)
  const getItemKey = useCallback((index: number) => messages[index].id, [messages])
  const getScrollElement = useCallback(
    () => scrollRef?.current ?? null,
    [scrollRef],
  )

  useEffect(() => {
    const el = scrollRef?.current
    const list = listRef.current
    if (!el || !list?.parentElement) return
    const updateMargin = () => {
      setScrollMargin(list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop)
    }
    updateMargin()
    const observer = new ResizeObserver(updateMargin)
    observer.observe(list.parentElement)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRef])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getItemKey,
    getScrollElement,
    estimateSize: () => 60,
    overscan: 15,
    scrollMargin: scrollMargin ?? 0,
    anchorTo: 'end',
  })

  const totalSize = virtualizer.getTotalSize()
  // Normal-flow rows still share measurements and anchors with the virtual layout.
  const items = virtualize
    ? virtualizer.getVirtualItems()
    : messages.map((_, index) => ({ index, start: 0 }))

  return (
    <div ref={listRef} style={{ height: virtualize ? totalSize : undefined, position: 'relative' }}>
      {items.map((item) => {
        const msg = messages[item.index]
        return (
          <div
            key={msg.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={virtualize ? {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start - (scrollMargin ?? 0)}px)`,
            } : { display: 'flow-root' }}
          >
            <ChatMessageRow message={msg} />
          </div>
        )
      })}
    </div>
  )
}

// ── Thinking indicator ───────────────────────────────────

function ThinkingIndicator({
  isRunning,
  isCancelling,
  workingStep,
  onCancel,
}: {
  isRunning: boolean
  isCancelling: boolean
  workingStep?: string | null
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  if (!isRunning) return null

  return (
    <div className="flex items-center gap-2.5 my-2 px-3 py-2 text-xs text-muted-foreground animate-message-enter">
      <span className="thinking-dots flex items-center gap-[3px] text-violet-500/70 dark:text-violet-400/70">
        <span />
        <span />
        <span />
      </span>
      <span className="font-medium text-violet-500/70 dark:text-violet-400/70">
        {isCancelling ? t('session.cancelling') : t('session.thinking')}
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
              className="ml-auto rounded-md border border-border/40 bg-background/80 px-2 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:border-border disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? t('session.cancellingBtn') : t('common.cancel')}
            </button>
          ) :
        null}
    </div>
  )
}

// ── Pending messages ─────────────────────────────────────

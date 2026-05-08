import type { ChatMessage, NormalizedLogEntry, TaskPlanChatMessage } from '@bkd/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, ChevronDown, Circle, ListTodo, Loader2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { useViewModeStore } from '@/stores/view-mode-store'
import { AcpTimeline } from './AcpTimeline'
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

export function SessionMessages(props: {
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  engineType?: string
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { engineType, ...rest } = props

  if (engineType === 'acp') {
    return <AcpTimeline {...rest} />
  }

  return <LegacySessionMessages {...rest} />
}

/** Threshold: below this count, render without virtualization for simpler layout. */
const VIRTUALIZE_THRESHOLD = 80

function LegacySessionMessages({
  logs,
  scrollRef,
  isRunning = false,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { t } = useTranslation()
  const fullWidthChat = useViewModeStore(s => s.fullWidthChat)

  // Transform flat entries → grouped ChatMessage[]
  const { messages, pendingMessages } = useChatMessages(logs)

  const useVirtual = messages.length >= VIRTUALIZE_THRESHOLD

  // Auto-scroll to bottom on new messages
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
  // useLayoutEffect: runs synchronously after DOM mutations but before browser
  // paint, so the user never sees a "scroll-from-top-to-bottom" flash on issue
  // switch (we ride on `key={issueId}` in ChatBody to remount this subtree;
  // remount resets initialScrollDone, then this effect snaps to bottom before
  // the new content is painted).
  //
  // Falls back to a layout pass triggered by messages.length changing, so that
  // even if logs arrive after the first paint (cache miss), we still snap to
  // bottom on the very next render rather than animating.
  useLayoutEffect(() => {
    if (initialScrollDone.current || (messages.length === 0 && pendingMessages.length === 0)) return
    const el = scrollRef?.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    initialScrollDone.current = true
  }, [messages.length, pendingMessages.length, scrollRef])

  const prevLenRef = useRef(messages.length)
  const prevFirstIdRef = useRef(messages[0]?.id)
  const firstMessageId = messages[0]?.id
  // Track last message content length so streaming updates trigger auto-scroll
  const lastMsg = messages.at(-1)
  const lastContentLen = lastMsg?.type === 'assistant'
    ? (lastMsg.entry.content?.length ?? 0)
    : 0

  useEffect(() => {
    if (!initialScrollDone.current) return
    const wasOlderPrepend =
      messages.length > prevLenRef.current &&
      prevFirstIdRef.current &&
      firstMessageId !== prevFirstIdRef.current

    if (
      !wasOlderPrepend &&
      nearBottomRef.current &&
      (messages.length !== prevLenRef.current || isRunning)
    ) {
      const el = scrollRef?.current
      el?.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      })
    }
    prevLenRef.current = messages.length
    prevFirstIdRef.current = firstMessageId
  }, [firstMessageId, isRunning, lastContentLen, messages.length, scrollRef])

  if (messages.length === 0 && pendingMessages.length === 0 && !isRunning) return null

  return (
    <div className={`flex flex-col py-3 px-4 max-md:gap-3 md:py-2 md:px-5${fullWidthChat ? '' : ' max-w-4xl'}`}>
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
      {useVirtual ?
          (
            <VirtualMessageList
              messages={messages}
              scrollRef={scrollRef}
            />
          ) :
          messages.map(msg => (
            <ChatMessageRow key={msg.id} message={msg} />
          ))}
      {/* Thinking indicator was here. The ChatGPT-style ThinkingHover in
          ChatArea now owns this UI — pulse + elapsed timer + workingStep
          + Cancel button — so it's visible at the top of the chat instead
          of buried at the bottom of the message list. Props are still
          piped through (isCancelling/workingStep/onCancel) so reverting
          is just bringing the component back. */}
    </div>
  )
}

// ── Virtualized message list ─────────────────────────────

function VirtualMessageList({
  messages,
  scrollRef,
}: {
  messages: ChatMessage[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
}) {
  const getScrollElement = useCallback(
    () => scrollRef?.current ?? null,
    [scrollRef],
  )

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement,
    estimateSize: () => 60,
    overscan: 15,
  })

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((item) => {
        const msg = messages[item.index]
        return (
          <div
            key={msg.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
            }}
          >
            <ChatMessageRow message={msg} />
          </div>
        )
      })}
    </div>
  )
}

// ── Thinking indicator was here ─────────────────────────
// Moved to ThinkingHover in ChatArea — see git history for the original
// implementation if reverting is ever needed.

// ── Pending messages ─────────────────────────────────────

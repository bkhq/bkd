import type { ChatMessage, NormalizedLogEntry, TaskPlanChatMessage, TimelineEntry } from '@bkd/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CheckCircle2, ChevronDown, Circle, ListTodo, Loader2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { useChatSearchStore } from '@/stores/chat-search-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import { AcpTimeline } from './AcpTimeline'
import { LogEntry } from './LogEntry'
import { ToolGroupMessage } from './ToolItems'

// ── ChatMessage renderer ─────────────────────────────────

function messageIdOf(message: ChatMessage): string | undefined {
  if ('entry' in message && message.entry) {
    return (message.entry as NormalizedLogEntry).messageId
  }
  return undefined
}

/** Briefly flash a yellow ring on a jumped-to message bubble. */
function flashHighlight(el: Element) {
  el.classList.add('bkd-search-flash')
  setTimeout(() => el.classList.remove('bkd-search-flash'), 1800)
}

/**
 * Scroll the bubble for `messageId` into view inside `root` and flash it.
 * Polls briefly because virtualized rows mount a frame or two after a
 * `scrollToIndex` call.
 */
function scrollToMessage(root: HTMLElement | null, messageId: string) {
  if (!root) return
  let tries = 0
  const tick = () => {
    const el = root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flashHighlight(el)
      return
    }
    if (tries++ < 40) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const ChatMessageRow = memo(({ message }: { message: ChatMessage }) => {
  const inner = renderChatMessage(message)
  const mid = messageIdOf(message)
  if (!mid) return inner
  return <div data-message-id={mid}>{inner}</div>
})

function renderChatMessage(message: ChatMessage) {
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
}

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
  logs: TimelineEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  engineType?: string
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  savedScroll?: number
}) {
  const { engineType, savedScroll, ...rest } = props

  if (engineType?.startsWith('acp')) {
    return <AcpTimeline {...rest} />
  }

  return <LegacySessionMessages {...rest} savedScroll={savedScroll} />
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
  savedScroll,
}: {
  logs: NormalizedLogEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  savedScroll?: number
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
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
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
  //
  // If savedScroll is provided (user has a saved position from a previous visit),
  // skip the auto-scroll — ChatBody's own restore effect handles it.
  useLayoutEffect(() => {
    if (savedScroll !== undefined && savedScroll > 0) {
      initialScrollDone.current = true
      return
    }
    if (initialScrollDone.current || (messages.length === 0 && pendingMessages.length === 0)) return
    const el = scrollRef?.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    initialScrollDone.current = true
  }, [messages.length, pendingMessages.length, scrollRef, savedScroll])

  const prevLenRef = useRef(messages.length)
  const prevFirstIdRef = useRef(messages[0]?.id)
  const firstMessageId = messages[0]?.id
  // Track last message content length so streaming updates trigger auto-scroll
  const lastMsg = messages.at(-1)
  const lastContentLen = lastMsg?.type === 'assistant'
    ? (lastMsg.entry.content?.length ?? 0)
    : 0

  // Scroll anchoring on prepend.
  //
  // When older logs are prepended to the top of the list, browsers (and
  // @tanstack/react-virtual in the virtualized branch) don't reliably
  // anchor the user's viewport — `scrollTop` stays at the same numeric
  // value while the content above grew by `delta`, so the user visibly
  // jumps to the top of the new content. We track `scrollHeight` between
  // renders and compensate manually before paint.
  //
  // useLayoutEffect, not useEffect: runs synchronously after DOM commit
  // and before paint, so the adjustment is invisible to the user. Runs
  // before the existing scroll-to-bottom useEffect below, which is fine —
  // both branches check `wasOlderPrepend` and mutually exclude.
  const prevScrollHeightRef = useRef(0)
  useLayoutEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const wasOlderPrepend =
      initialScrollDone.current &&
      messages.length > prevLenRef.current &&
      prevFirstIdRef.current &&
      firstMessageId !== prevFirstIdRef.current
    if (wasOlderPrepend && prevScrollHeightRef.current > 0) {
      const delta = el.scrollHeight - prevScrollHeightRef.current
      if (delta > 0) el.scrollTop = el.scrollTop + delta
      // Correct after virtualizer finishes measuring in the next frame
      requestAnimationFrame(() => {
        const finalDelta = el.scrollHeight - prevScrollHeightRef.current
        if (finalDelta > 0) el.scrollTop = el.scrollTop + (finalDelta - delta)
      })
    }
    prevScrollHeightRef.current = el.scrollHeight
  }, [firstMessageId, messages.length, scrollRef])

  // Auto-load older logs when the top of the message list nears the
  // viewport. IntersectionObserver fires on the actual intersection event
  // (not every scroll tick), so it doesn't re-trigger on streaming bottom
  // updates the way a scrollTop threshold check would. Combined with the
  // anchoring effect above, after each load the user stays on the same
  // message and the sentinel slides out of view — no infinite-fetch loop.
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
    // Scroll-based fallback: IntersectionObserver occasionally misses fast
    // inertial scrolls on iOS Safari and on some Android WebViews, so the
    // sentinel never reports "intersecting" until the user pokes the page
    // again. Sharing the same guard with the observer makes the two safe
    // to coexist — whichever fires first wins, the second is suppressed.
    const onScroll = () => {
      if (root.scrollTop <= 300) trigger()
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', onScroll)
    }
    // messages.length: sentinel div is gated by the `return null` early-exit
    // below. On a cold mount (logs not yet fetched) the first render produces
    // no DOM, so topSentinelRef.current is null and this effect bails out.
    // Without re-running when messages first appear, the observer + scroll
    // fallback are never attached and scroll-up-to-load never fires.
  }, [scrollRef, onLoadOlder, messages.length])

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
      el?.scrollTo({ top: el.scrollHeight })
    }
    prevLenRef.current = messages.length
    prevFirstIdRef.current = firstMessageId
  }, [firstMessageId, isRunning, lastContentLen, messages.length, scrollRef])

  // In-chat search jump (non-virtualized branch). The virtualized branch
  // handles its own jump inside VirtualMessageList since it needs the
  // virtualizer to bring an off-screen row into the DOM first.
  const jumpNonce = useChatSearchStore(s => s.jumpNonce)
  const jumpMessageId = useChatSearchStore(s => s.jumpMessageId)
  useEffect(() => {
    if (useVirtual || !jumpMessageId) return
    scrollToMessage(scrollRef?.current ?? null, jumpMessageId)
  }, [jumpNonce, jumpMessageId, useVirtual, scrollRef])

  if (messages.length === 0 && pendingMessages.length === 0 && !isRunning) return null

  return (
    <div className={`flex flex-col py-3 px-4 gap-3 md:py-2 md:px-5${fullWidthChat ? '' : ' max-w-4xl'}`}>
      {/* IntersectionObserver sentinel — auto-loads older history when
          the top of the list nears the viewport. Replaces the previous
          explicit "Load earlier messages" button (universal mobile chat
          idiom: Slack / Telegram / Discord / iMessage). */}
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

  // In-chat search jump: bring the target row's index into view via the
  // virtualizer (so the row mounts), then scroll + flash the bubble.
  const jumpNonce = useChatSearchStore(s => s.jumpNonce)
  const jumpMessageId = useChatSearchStore(s => s.jumpMessageId)
  useEffect(() => {
    if (!jumpMessageId) return
    const idx = messages.findIndex(m => messageIdOf(m) === jumpMessageId)
    if (idx < 0) return
    virtualizer.scrollToIndex(idx, { align: 'center' })
    // A second pass after layout settles — dynamically-measured rows can
    // shift the first estimate.
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(idx, { align: 'center' })
      scrollToMessage(scrollRef?.current ?? null, jumpMessageId)
    })
  }, [jumpNonce, jumpMessageId, messages, virtualizer, scrollRef])

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((item) => {
        const msg = messages[item.index]
        return (
          <div
            key={msg.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="pb-3"
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

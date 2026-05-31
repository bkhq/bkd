import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronRight, Clock, FileText, Trash2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useIssueStream } from '@/hooks/use-issue-stream'
import {
  useCancelIssue,
  useDeleteIssue,
  useGlobalSlashCommands,
  useSlashCommands,
  useUpdateIssue,
} from '@/hooks/use-kanban'
import { useInvalidatePendingMessages, usePendingMessages } from '@/hooks/use-pending-messages'
import { formatFileSize } from '@/lib/format'
import { kanbanApi } from '@/lib/kanban-api'
import { STATUS_MAP } from '@/lib/statuses'
import { useChatFilterStore } from '@/stores/chat-filter-store'
import { useScrollPositionStore } from '@/stores/scroll-position-store'
import type { Issue, NormalizedLogEntry } from '@/types/kanban'
import { ChatInput } from './ChatInput'
import { ChatSearchBar } from './ChatSearchBar'
import { CurrentPromptHover } from './CurrentPromptHover'
import { IssueDetail } from './IssueDetail'
import { ThinkingHover } from './ThinkingHover'

const LazySessionMessages = lazy(() =>
  import('./SessionMessages').then(m => ({ default: m.SessionMessages })),
)

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled'])

// ---------- shared session-state helpers ----------

function deriveWorkingStep(logs: NormalizedLogEntry[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]
    if (entry.entryType !== 'tool-use') continue
    const md = entry.metadata
    if (!md || md.isResult === true || md.toolName !== 'TodoWrite') continue
    const input = md.input as { todos?: Array<Record<string, unknown>> } | undefined
    const todos = Array.isArray(input?.todos) ? input.todos : []
    if (todos.length === 0) continue
    const inProgress = todos.find(todo => todo.status === 'in_progress')
    const pending = todos.find(todo => todo.status === 'pending')
    const completed = todos.toReversed().find(todo => todo.status === 'completed')
    const current = inProgress ?? pending ?? completed ?? todos[0]
    const activeForm = typeof current.activeForm === 'string' ? current.activeForm : null
    const content = typeof current.content === 'string' ? current.content : null
    return activeForm ?? content ?? null
  }
  return null
}

// ---------- exported hook (for title bars that need isThinking) ----------

// When devMode is off (default concise view), the stream is filtered to
// these entry types only. Turning devMode on removes the filter and shows
// all raw entries (tool-use, system-message, etc.).
const CONCISE_TYPE_LIST: readonly string[] = [
  'user-message',
  'assistant-message',
  'thinking',
]

export function useSessionState(
  projectId: string,
  issueId: string | null,
  issue: Issue | null | undefined,
) {
  const hasSession = !!issue?.sessionStatus
  const isTodo = issue?.statusId === 'todo'
  const isDone = issue?.statusId === 'done'
  const streamEnabled = hasSession || isTodo || isDone

  const devMode = useChatFilterStore(s => s.devMode)
  const streamTypes = devMode ? undefined : CONCISE_TYPE_LIST

  const {
    logs,
    sessionStatus: streamStatus,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    loadLogWindow,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  } = useIssueStream({
    projectId,
    issueId: streamEnabled ? issueId : null,
    sessionStatus: issue?.sessionStatus ?? null,
    enabled: !!(issueId && streamEnabled),
    types: streamTypes,
  })

  // Merge SSE-derived status with React Query status for resilience.
  // If EITHER source reports a terminal state, stop thinking immediately.
  // SSE updates are instant; React Query may lag behind due to invalidation
  // + refetch cycles, but can also recover via window focus or staleTime.
  const streamIsTerminal = !!streamStatus && TERMINAL_STATUSES.has(streamStatus)
  const queryStatus = issue?.sessionStatus ?? null
  const effectiveStatus = streamIsTerminal ? streamStatus : queryStatus
  const isSessionActive = effectiveStatus === 'running' || effectiveStatus === 'pending'

  // When the session is active (running/pending), always show thinking.
  // Previously we used hasUnfinishedSegmentIn(logs) to detect mid-turn
  // completion, but this caused a false negative: when a new follow-up
  // starts, the old turnCompleted marker is still the last log entry,
  // making hasUnfinishedSegmentIn() return false for up to several seconds
  // while the process spawns.  The small trade-off (indicator lingers
  // ~200ms after a turn actually completes until DB status updates to
  // 'completed') is far better than the indicator not showing at all.
  const isThinking = isSessionActive

  const workingStep = deriveWorkingStep(logs)

  return {
    logs,
    isThinking,
    workingStep,
    isTodo,
    isDone,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    loadLogWindow,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  }
}

// ---------- ChatBody component ----------

export function ChatBody({
  projectId,
  issueId,
  issue,
  showDiff,
  onToggleDiff,
  scrollRef: externalScrollRef,
  onAfterDelete,
  titleVisible = true,
  searchOpen = false,
  onCloseSearch,
}: {
  projectId: string
  issueId: string
  issue: Issue
  showDiff: boolean
  onToggleDiff: () => void
  scrollRef?: React.RefObject<HTMLDivElement | null>
  onAfterDelete?: () => void
  /**
   * Whether the parent ChatArea's title bar is visible — when false on
   *  mobile the ThinkingHover slides up to take the title's place.
   */
  titleVisible?: boolean
  /** In-chat search panel open state (controlled from ChatArea). */
  searchOpen?: boolean
  onCloseSearch?: () => void
}) {
  const { t } = useTranslation()
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalScrollRef ?? internalScrollRef

  const updateIssue = useUpdateIssue(projectId)
  const cancelIssue = useCancelIssue(projectId)
  const deleteIssueMutation = useDeleteIssue(projectId)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [pendingEditContent, setPendingEditContent] = useState<string | null>(null)

  const handleDelete = useCallback(() => {
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    deleteIssueMutation.mutate(issueId, {
      onSuccess: () => {
        setDeleteDialogOpen(false)
        onAfterDelete?.()
      },
    })
  }, [deleteIssueMutation, issueId, onAfterDelete])

  const hasSession = !!issue.sessionStatus
  const { data: globalCmds } = useGlobalSlashCommands(issue.engineType)
  const { data: liveCmds } = useSlashCommands(projectId, issueId, hasSession)
  const hasLive =
    (liveCmds?.commands?.length ?? 0) > 0 ||
    (liveCmds?.plugins?.length ?? 0) > 0
  const activeCmds = hasLive ? liveCmds : globalCmds
  const slashCommands = activeCmds?.commands ?? []
  const pluginCommands = activeCmds?.plugins ?? []

  const {
    logs,
    isThinking,
    workingStep,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    loadLogWindow,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  } = useSessionState(projectId, issueId, issue)

  // Always fetch pending messages independently of stream state
  const { data: serverPendingMessages } = usePendingMessages(projectId, issueId)
  const invalidatePending = useInvalidatePendingMessages()
  const [pendingCollapsed, setPendingCollapsed] = useState(false)

  const handleEditPending = useCallback(async (messageId: string) => {
    try {
      const result = await kanbanApi.deletePendingMessage(projectId, issueId, messageId)
      setPendingEditContent(result.content)
      removeEntries([result.id])
      invalidatePending(projectId, issueId)
    } catch {
      /* ignore — pending may have been consumed already */
    }
  }, [projectId, issueId, removeEntries, invalidatePending])

  const handleDiscardPending = useCallback(async (messageId: string) => {
    try {
      const result = await kanbanApi.deletePendingMessage(projectId, issueId, messageId)
      // Same as edit, but DO NOT restore content to input — pure discard.
      removeEntries([result.id])
      invalidatePending(projectId, issueId)
    } catch {
      /* ignore — pending may have been consumed already */
    }
  }, [projectId, issueId, removeEntries, invalidatePending])

  const handleClearAllPending = useCallback(async () => {
    try {
      await kanbanApi.clearAllPendingMessages(projectId, issueId)
      // SSE log-removed will arrive; also do an immediate invalidate.
      invalidatePending(projectId, issueId)
    } catch {
      /* ignore */
    }
  }, [projectId, issueId, invalidatePending])

  // Reset cancelling state when the session settles or a new turn starts.
  // Without the sessionStatus check, a follow-up that keeps isThinking=true
  // would leave isCancelling stuck, blocking the user from cancelling the new turn.
  const prevSessionStatusRef = useRef(issue.sessionStatus)
  useEffect(() => {
    const prev = prevSessionStatusRef.current
    prevSessionStatusRef.current = issue.sessionStatus
    if (!isCancelling) return
    // Session settled
    if (!isThinking) {
      setIsCancelling(false)
      return
    }
    // New turn started (e.g. follow-up reactivated while cancel was in progress)
    if (issue.sessionStatus === 'running' && prev !== 'running') {
      setIsCancelling(false)
    }
  }, [isCancelling, isThinking, issue.sessionStatus])

  // Show toast when execution transitions to failed
  const prevStatusRef = useRef(issue.sessionStatus)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = issue.sessionStatus
    if (issue.sessionStatus === 'failed' && prev != null && prev !== 'failed') {
      toast.error(t('session.executionFailed'))
    }
  }, [issue.sessionStatus, t])

  // Track scroll position for scroll-to-top / scroll-to-bottom buttons
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  // Persist scroll position per issue so revisiting picks up where the
  // user left off (Slack / Discord / mail-client style). Saved on scroll,
  // restored once after logs first arrive — see useLayoutEffect below.
  const setSavedScroll = useScrollPositionStore(s => s.setPosition)
  const savedScroll = useScrollPositionStore(s => s.positions[issueId])

  // Mirror isLoadingOlder into a ref so the scroll handler can read the
  // current value without forcing this effect to re-attach the listener
  // on every load tick (which would also re-trigger the initial
  // handleScroll() call below).
  const isLoadingOlderRef = useRef(isLoadingOlder)
  useEffect(() => {
    isLoadingOlderRef.current = isLoadingOlder
  }, [isLoadingOlder])

  // Preserve the user's visible reading position when chrome (title bar /
  // metadata bar / input toolbar) collapses or expands on mobile. Without
  // this the chat container's clientHeight grows by ~80px on auto-hide and
  // the bottom-anchored content slides down by the same amount, which
  // reads as a jarring re-layout. We watch clientHeight via ResizeObserver
  // and counter-scroll by the delta so the same row stays under the
  // user's eye.
  //
  // CSS transitions on chrome elements fire many small resize events over
  // ~200ms. Immediate counter-scrolling on each tick "fights" the transition
  // and produces visible jumping. We debounce by 250ms so only the total
  // delta is applied, after the transition settles.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let stableHeight = el.clientHeight
    let timer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        const delta = el.clientHeight - stableHeight
        if (delta !== 0 && !isLoadingOlderRef.current && el.scrollTop > 0) {
          el.scrollTop = Math.max(0, el.scrollTop - delta)
        }
        stableHeight = el.clientHeight
        timer = null
      }, 250)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let rafId = 0
    const handleScroll = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const { scrollTop, scrollHeight, clientHeight } = el
        setShowScrollTop(scrollTop > 200)
        setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 80)
        // Save scroll position only when there's real content to scroll
        // and we're not in the middle of prepending older logs. Without
        // these guards we'd persist the transient scrollTop=0 captured on
        // initial mount (no content yet) or mid-prepend (before anchoring
        // restores position) into localStorage, poisoning future visits.
        const isScrollable = scrollHeight - clientHeight > 0
        if (isScrollable && !isLoadingOlderRef.current) {
          setSavedScroll(issueId, scrollTop)
        }
      })
    }

    handleScroll()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [scrollRef, logs.length, issueId, setSavedScroll])

  // Restore the saved scroll position once per issue, after logs first
  // arrive. Runs synchronously before paint (useLayoutEffect) so the user
  // never sees the auto-bottom flash from SessionMessages's own scroll
  // effect — that one fires earlier in the commit phase (child first), so
  // we just override its scrollTop here. If there's no saved position
  // (first-ever visit to this issue), we leave SessionMessages's
  // bottom-scroll in place so the user lands on the latest message.
  const restoredForIssueRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (logs.length === 0) return
    if (restoredForIssueRef.current === issueId) return
    // Ignore polluted savedScroll≤0 entries from the pre-anchoring era
    // (when the scroll handler would persist 0 mid-prepend or on mount).
    // SessionMessages' own snap-to-bottom remains in place — landing on
    // the latest message is the right default if we have nothing better.
    if (savedScroll === undefined || savedScroll <= 0) {
      restoredForIssueRef.current = issueId
      return
    }
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = savedScroll
    restoredForIssueRef.current = issueId
  }, [issueId, logs.length, savedScroll, scrollRef])

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [scrollRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [scrollRef])

  return (
    <>
      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        {/* Floating overlay at the top of chat:
            CurrentPromptHover — surfaces the user prompt of the turn the
            reader is currently viewing once they've scrolled past it.
            Self-gates internally (hides when only one turn or when the
            prompt is in view), so it's mounted unconditionally.

            The floating ThinkingHover variant used to sit here too, but it
            duplicated the inline ticker at the bottom (which already shows
            status next to the latest message) and on mobile it competed
            with the auto-hidden title bar for the same screen real estate.
            Inline-only is sufficient. */}
        <div
          className={`pointer-events-none absolute left-2 right-2 z-10 flex flex-col gap-1.5 transition-[top,opacity] duration-200 ease-out ${
            titleVisible ? 'top-2 max-md:top-[40px]' : 'top-2'
          }`}
        >
          <div className="pointer-events-auto">
            <CurrentPromptHover logs={logs} scrollRef={scrollRef} />
          </div>
        </div>
        <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden">
          {searchOpen
            ? (
                <ChatSearchBar
                  issueId={issueId}
                  loadLogWindow={loadLogWindow}
                  open={searchOpen}
                  onClose={() => onCloseSearch?.()}
                />
              )
            : null}
          {/* Mobile top padding tracks titleVisible: when the absolute-positioned
              title bar is visible we reserve ~52px so the load spinner / first
              message aren't hidden behind it; when the bar slides away we drop
              the padding to 8px so the chat content reclaims the freed space
              (otherwise the user gets no real benefit from auto-hide). Desktop
              keeps the tight `py-1` baseline. */}
          <div
            className={`flex flex-col min-h-full justify-end py-1 transition-[padding-top] duration-200 ease-out ${
              titleVisible ? 'max-md:pt-[44px]' : 'max-md:pt-2'
            }`}
          >
            <Suspense
              fallback={
                <div className="px-5 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
              }
            >
              {/* key={issueId}: force-remount on issue switch so the internal
                  scroll refs in SessionMessages (initialScrollDone, nearBottomRef,
                  prevLenRef, prevFirstIdRef) reset cleanly. Otherwise stale state
                  from the previous issue caused a visible scroll jump / smooth
                  animation on every switch. */}
              <LazySessionMessages
                key={issueId}
                logs={logs}
                scrollRef={scrollRef}
                engineType={issue.engineType ?? undefined}
                isRunning={isThinking}
                workingStep={workingStep}
                onCancel={() => {
                  setIsCancelling(true)
                  cancelIssue.mutate(issueId, {
                    onError: () => setIsCancelling(false),
                  })
                }}
                isCancelling={isCancelling}
                hasOlderLogs={hasOlderLogs}
                isLoadingOlder={isLoadingOlder}
                onLoadOlder={loadOlderLogs}
                savedScroll={savedScroll}
              />
            </Suspense>
            {/* Inline thinking ticker — anchored to the bottom of the
                message list so the user sees status right next to the
                latest message while waiting for a reply. The floating
                variant in the overlay above replaces this when the user
                scrolls up to read history. Only one of the two is in the
                DOM at any moment (showScrollBottom gates them). */}
            {!showScrollBottom ?
                (
                  <ThinkingHover
                    isActive={isThinking}
                    workingStep={workingStep}
                    isCancelling={isCancelling}
                    onCancel={() => {
                      setIsCancelling(true)
                      cancelIssue.mutate(issueId, {
                        onError: () => setIsCancelling(false),
                      })
                    }}
                    variant="inline"
                  />
                ) :
              null}
          </div>
        </div>

        {/* Scroll-to-top / scroll-to-bottom floating buttons */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
          {showScrollTop ?
              (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="rounded-full border border-border/50 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
                  title={t('session.scrollToTop')}
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </button>
              ) :
            null}
          {showScrollBottom ?
              (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="rounded-full border border-border/50 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
                  title={t('session.scrollToBottom')}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </button>
              ) :
            null}
        </div>
      </div>

      {/* Pending messages — reuses user-message styling from LogEntry */}
      {serverPendingMessages && serverPendingMessages.length > 0 && (
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={() => setPendingCollapsed(v => !v)}
            className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            {pendingCollapsed
              ? <ChevronRight className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />}
            <Clock className="h-2.5 w-2.5 text-amber-500/70" />
            <span>{t('chat.pendingCount', { count: serverPendingMessages.length })}</span>
          </button>
          {!pendingCollapsed && serverPendingMessages.length > 0 && (
            <button
              type="button"
              data-testid="pending-clear-all"
              onClick={handleClearAllPending}
              className="flex items-center gap-1 shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              title={t('chat.pendingClearAll', 'Clear all pending')}
              aria-label={t('chat.pendingClearAll', 'Clear all pending')}
            >
              <Trash2 className="h-3 w-3" />
              <span>{t('chat.pendingClearAll', 'Clear all')}</span>
            </button>
          )}
        </div>
      )}
      {serverPendingMessages && serverPendingMessages.length > 0 && !pendingCollapsed && (
        <div className="px-4 pb-2 pt-1 space-y-1 max-h-[30vh] overflow-y-auto">
          {serverPendingMessages.map((msg) => {
            const isDone = msg.metadata?.type === 'done'
            const barColor = isDone
              ? 'border-emerald-400 bg-emerald-500/[0.06]'
              : 'border-amber-400 bg-amber-500/[0.06]'
            const attachments = (msg.metadata?.attachments ?? []) as Array<{ id: string, name: string, mimeType: string, size: number }>
            const displayContent = msg.content.replace(/\n*--- Attached files ---\n(?:\[Attached file:.*\]\n?)*/g, '').trim()
            return (
              <div key={msg.messageId} className="group py-2 animate-message-enter">
                <div className={`bg-muted/70 px-3 py-2.5 border border-l-[3px] ${barColor}`}>
                  {displayContent
                    ? (
                        <div className="text-[15px] whitespace-pre-wrap break-words text-foreground leading-[1.75]">
                          {displayContent}
                        </div>
                      )
                    : null}
                  {attachments.length > 0
                    ? (
                        <div className={`flex flex-wrap gap-1.5${displayContent ? ' mt-2' : ''}`}>
                          {attachments.map((att) => {
                            const isImage = att.mimeType.startsWith('image/')
                            const baseUrl = `/api/projects/${projectId}/issues/${issueId}/attachments/${att.id}`
                            return isImage
                              ? (
                                  <a
                                    key={att.id}
                                    href={`${baseUrl}?preview`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block rounded border border-border/40 overflow-hidden max-w-[200px] max-h-[150px] group/img"
                                    title={`${att.name} (${formatFileSize(att.size)})`}
                                  >
                                    <img
                                      src={`${baseUrl}?preview`}
                                      alt={att.name}
                                      className="object-cover w-full h-full transition-transform group-hover/img:scale-105"
                                      loading="lazy"
                                    />
                                  </a>
                                )
                              : (
                                  <a
                                    key={att.id}
                                    href={baseUrl}
                                    download={att.name}
                                    className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border/40 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                                  >
                                    <FileText className="h-3 w-3 shrink-0" />
                                    <span className="truncate max-w-[120px]">{att.name}</span>
                                    <span className="text-muted-foreground/50">{formatFileSize(att.size)}</span>
                                  </a>
                                )
                          })}
                        </div>
                      )
                    : null}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center gap-1 text-[10px] ${isDone ? 'text-emerald-500/70' : 'text-amber-500/70'}`}>
                      {!isDone ? <Clock className="h-2.5 w-2.5" /> : null}
                      {isDone ? t('chat.doneMessage') : t('chat.pendingMessage')}
                    </span>
                    <div className="ml-auto flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        data-testid={`pending-edit-${msg.messageId}`}
                        onClick={() => handleEditPending(msg.messageId)}
                        className="rounded-md border border-border/40 bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        data-testid={`pending-discard-${msg.messageId}`}
                        onClick={() => handleDiscardPending(msg.messageId)}
                        aria-label={t('chat.pendingDiscard', 'Discard pending message')}
                        title={t('chat.pendingDiscard', 'Discard pending message')}
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-border/40 bg-background/90 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Issue metadata bar — collapses with the title on mobile.
          The ChatBody-level ResizeObserver counter-scrolls when this
          changes height, so the user's visible reading position stays
          stable through the transition. */}
      <IssueDetail
        issue={issue}
        projectId={projectId}
        status={STATUS_MAP.get(issue.statusId)}
        onUpdate={fields => updateIssue.mutate({ id: issueId, ...fields })}
        onDelete={handleDelete}
        isDeleting={deleteIssueMutation.isPending}
        collapsed={!titleVisible}
      />

      {/* Input */}
      <ChatInput
        projectId={projectId}
        issueId={issueId}
        diffOpen={showDiff}
        onToggleDiff={onToggleDiff}
        scrollRef={scrollRef}
        engineType={issue.engineType ?? undefined}
        model={issue.model ?? undefined}
        sessionStatus={issue.sessionStatus}
        statusId={issue.statusId}
        isThinking={isThinking}
        onCancel={() => {
          setIsCancelling(true)
          cancelIssue.mutate(issueId, {
            onError: () => setIsCancelling(false),
          })
        }}
        isCancelling={isCancelling}
        slashCommands={slashCommands}
        pluginCommands={pluginCommands}
        onRefreshLogs={refreshLogs}
        onMessageSent={(messageId, prompt, metadata) => {
          appendServerMessage(messageId, prompt, metadata)
        }}
        pendingEditContent={pendingEditContent}
        onPendingEditConsumed={() => setPendingEditContent(null)}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('issue.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('issue.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteIssueMutation.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteIssueMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                handleConfirmDelete()
              }}
            >
              {deleteIssueMutation.isPending ? t('issue.deleting') : t('issue.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

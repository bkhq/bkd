import type {
  CockpitTimelineAction,
  CockpitTimelineMessage,
  CockpitTimelineMessageKind,
} from '@bkd/shared'
import { AlertTriangle, Bell, BellOff, Bot, Check, CircleAlert, Clock, GitBranch, Hourglass, Lightbulb, MessageSquare, Send, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import {
  useAckCockpitTimeline,
  useCockpitTimeline,
  useDismissCockpitTimeline,
  useExecuteCockpitAction,
  useSnoozeCockpitTimeline,
} from '@/hooks/use-cockpit-timeline'
import { eventBus } from '@/lib/event-bus'
import { cn } from '@/lib/utils'
import { ForkDialog } from '../issue-detail/ForkDialog'
import { CockpitQuickCreate } from './CockpitQuickCreate'

const HOUR_MS = 60 * 60 * 1000
const BULK_MERGE_CAP = 5
const SOUND_STORAGE_KEY = 'cockpit.timeline.sound'
const URGENT_KINDS: ReadonlySet<CockpitTimelineMessageKind> = new Set([
  'alert_off_track',
  'alert_repeat_fail',
  'alert_stale_working',
  'suggest_reply',
])

function endOfTodayMs(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

function playDing(): void {
  try {
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain).connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.start()
    osc.stop(ctx.currentTime + 0.35)
    setTimeout(() => {
      void ctx.close().catch(() => {})
    }, 600)
  } catch {
    // best-effort; never throw to the UI
  }
}

function kindIcon(kind: CockpitTimelineMessageKind) {
  switch (kind) {
    case 'suggest_merge':
      return <Check className="h-3.5 w-3.5 text-emerald-500" />
    case 'alert_off_track':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    case 'suggest_reply':
      return <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
    case 'alert_repeat_fail':
      return <CircleAlert className="h-3.5 w-3.5 text-rose-500" />
    case 'alert_stale_working':
      return <Hourglass className="h-3.5 w-3.5 text-violet-500" />
    case 'ack':
      return <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
    case 'info':
    default:
      return <Bot className="h-3.5 w-3.5 text-sky-500" />
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function BotTimeline() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useCockpitTimeline()
  const ack = useAckCockpitTimeline()
  const dismiss = useDismissCockpitTimeline()
  const snooze = useSnoozeCockpitTimeline()
  const execute = useExecuteCockpitAction()
  const navigate = useNavigate()

  // Per-row UI state.
  const [selectedMerge, setSelectedMerge] = useState<Set<string>>(new Set())
  const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false)
  // Which message's fork dialog is open (cockpit forks the whole issue).
  const [forkFor, setForkFor] = useState<CockpitTimelineMessage | null>(null)

  const visible = useMemo(() => {
    if (!data) return []
    return data.messages.filter(m => m.status === 'open' || m.status === 'acknowledged')
  }, [data])

  const mergeRows = useMemo(
    () => visible.filter(m => m.kind === 'suggest_merge' && m.status === 'open' && m.issueId),
    [visible],
  )
  const mergeRowIds = useMemo(() => mergeRows.map(m => m.id), [mergeRows])

  const counts = data?.counts ?? {
    suggest_merge: 0,
    alert_off_track: 0,
    suggest_reply: 0,
    alert_repeat_fail: 0,
    alert_stale_working: 0,
    ack: 0,
    info: 0,
  }

  // Sound + browser notification opt-in (persisted in localStorage).
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SOUND_STORAGE_KEY) === '1'
  })
  // Ref mirrors state so the SSE subscription effect doesn't re-bind on
  // every toggle change.
  const soundOnRef = useRef(soundOn)
  useEffect(() => {
    soundOnRef.current = soundOn
  }, [soundOn])

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SOUND_STORAGE_KEY, next ? '1' : '0')
      }
      if (next) {
        // Prime: play a short tick so the user knows it's on AND so the
        // AudioContext is unlocked by this user gesture. Also request
        // browser notification permission if we don't have it yet.
        playDing()
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => {})
        }
      }
      return next
    })
  }, [])

  // Subscribe to SSE deltas for sound + browser notification on urgent
  // appends. Mounted once; reads the latest toggle via ref.
  useEffect(() => {
    return eventBus.onCockpitTimeline((delta) => {
      if (delta.op !== 'append') return
      if (!URGENT_KINDS.has(delta.message.kind)) return
      if (!soundOnRef.current) return
      playDing()
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          // Title is intentionally generic so a glance doesn't leak
          // issue titles on a shared screen.
          const n = new Notification('BKD cockpit', {
            body: delta.message.body,
            silent: true,
            tag: delta.message.signalKey,
          })
          // Reference so the no-new lint rule passes and the browser
          // doesn't immediately GC the handle.
          void n
        } catch {
          /* ignore */
        }
      }
    })
  }, [])

  function toggleSelect(messageId: string) {
    setSelectedMerge((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else if (next.size < BULK_MERGE_CAP) next.add(messageId)
      else toast.warning(t('cockpit.timeline.bulkCap', 'Cap reached ({{n}})', { n: BULK_MERGE_CAP }))
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedMerge((prev) => {
      const eligibleIds = mergeRowIds.slice(0, BULK_MERGE_CAP)
      if (prev.size === eligibleIds.length && eligibleIds.every(id => prev.has(id))) {
        return new Set()
      }
      return new Set(eligibleIds)
    })
  }

  function runBulkMerge() {
    const ids = visible
      .filter(m => selectedMerge.has(m.id) && m.issueId)
      .map(m => m.issueId!) as string[]
    if (ids.length === 0) return
    execute.mutate({ type: 'bulk_merge', params: { issueIds: ids } }, {
      onSuccess: () => {
        toast.success(t('cockpit.timeline.bulkDone', '{{n}} merged', { n: ids.length }))
        // Ack each selected message so the rows disappear.
        for (const messageId of selectedMerge) void ack.mutateAsync(messageId)
        setSelectedMerge(new Set())
        setConfirmBulkOpen(false)
      },
      onError: (err: unknown) => {
        const m = err instanceof Error ? err.message : t('cockpit.timeline.actionFailed', 'Action failed')
        toast.error(m)
        setConfirmBulkOpen(false)
      },
    })
  }

  function dispatchSendReply(msg: CockpitTimelineMessage, body: string, onDone?: () => void) {
    const trimmed = body.trim()
    if (!trimmed || !msg.issueId) return
    execute.mutate({ type: 'send_reply', params: { issueId: msg.issueId, body: trimmed } }, {
      onSuccess: () => {
        void ack.mutateAsync(msg.id)
        toast.success(t('cockpit.timeline.replySent', 'Reply sent'))
        onDone?.()
      },
      onError: (err: unknown) => {
        const m = err instanceof Error ? err.message : t('cockpit.timeline.actionFailed', 'Action failed')
        toast.error(m)
      },
    })
  }

  function submitReply(msg: CockpitTimelineMessage) {
    dispatchSendReply(msg, replyDraft, () => {
      setReplyOpenFor(null)
      setReplyDraft('')
    })
  }

  function runAction(msg: CockpitTimelineMessage, action: CockpitTimelineAction) {
    switch (action.kind) {
      case 'proposal': {
        const payload = action.payload ?? {}
        const type = (payload.type as string | undefined) ?? ''
        const params = (payload.params as Record<string, unknown> | undefined) ?? {}
        if (!type) return
        execute.mutate({ type, params }, {
          onSuccess: () => {
            void ack.mutateAsync(msg.id)
            toast.success(t('cockpit.timeline.actionDone', 'Done'))
          },
          onError: (err: unknown) => {
            const m = err instanceof Error ? err.message : t('cockpit.timeline.actionFailed', 'Action failed')
            toast.error(m)
          },
        })
        return
      }
      case 'reply-input': {
        // Toggle inline reply textarea for this row.
        if (replyOpenFor === msg.id) {
          setReplyOpenFor(null)
          setReplyDraft('')
        } else {
          setReplyOpenFor(msg.id)
          setReplyDraft('')
        }
        return
      }
      case 'reply-preset': {
        // One-click candidate reply drafted by the secretary — send the
        // preset text straight back to the issue, no typing.
        const text = (action.payload?.text as string | undefined) ?? ''
        if (!text) return
        dispatchSendReply(msg, text)
        return
      }
      case 'navigate': {
        // Deep-link directly to the issue's chat view when we have both
        // the project alias and the issue id; fall back to /review for
        // global messages.
        if (msg.projectAlias && msg.issueId) {
          navigate(`/review/${encodeURIComponent(msg.projectAlias)}/${encodeURIComponent(msg.issueId)}`)
        } else {
          navigate('/review')
        }
        return
      }
      case 'snooze': {
        // Default snooze (used for backwards-compat actions) = 1h. The
        // per-row snooze dropdown bypasses runAction and calls
        // snooze.mutate directly with the chosen preset.
        const hours = (action.payload?.hours as number | undefined) ?? 1
        snooze.mutate({ id: msg.id, untilMs: Date.now() + hours * HOUR_MS })
        return
      }
      case 'dismiss': {
        dismiss.mutate(msg.id)
      }
    }
  }

  const eligibleMergeIds = mergeRowIds.slice(0, BULK_MERGE_CAP)
  const allSelected = eligibleMergeIds.length > 0
    && selectedMerge.size === eligibleMergeIds.length
    && eligibleMergeIds.every(id => selectedMerge.has(id))

  const busy = execute.isPending || ack.isPending || snooze.isPending || dismiss.isPending

  return (
    <div className="flex flex-col gap-3 px-5 py-4 max-w-3xl w-full mx-auto">
      {/* Status strip */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              counts.suggest_merge > 0 ?
                'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                'text-muted-foreground/60',
            )}
          >
            <Check className="h-3 w-3" />
            {t('cockpit.timeline.ready', '{{n}} ready', { n: counts.suggest_merge })}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              counts.suggest_reply > 0 ?
                'bg-sky-500/10 text-sky-600 dark:text-sky-400' :
                'text-muted-foreground/60',
            )}
          >
            <MessageSquare className="h-3 w-3" />
            {t('cockpit.timeline.awaiting', '{{n}} awaiting you', { n: counts.suggest_reply })}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              counts.alert_off_track > 0 ?
                'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                'text-muted-foreground/60',
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {t('cockpit.timeline.offTrack', '{{n}} off-track', { n: counts.alert_off_track })}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              counts.alert_repeat_fail > 0 ?
                'bg-rose-500/10 text-rose-600 dark:text-rose-400' :
                'text-muted-foreground/60',
            )}
          >
            <CircleAlert className="h-3 w-3" />
            {t('cockpit.timeline.repeatFail', '{{n}} failing', { n: counts.alert_repeat_fail })}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              counts.alert_stale_working > 0 ?
                'bg-violet-500/10 text-violet-600 dark:text-violet-400' :
                'text-muted-foreground/60',
            )}
          >
            <Hourglass className="h-3 w-3" />
            {t('cockpit.timeline.stale', '{{n}} stuck', { n: counts.alert_stale_working })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSound}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
            title={soundOn ?
                t('cockpit.timeline.soundOn', 'Sound on — click to mute') :
                t('cockpit.timeline.soundOff', 'Sound off — click to enable urgent alerts')}
            aria-label={soundOn ? 'Mute alerts' : 'Enable alert sound'}
            aria-pressed={soundOn}
            data-testid="cockpit-sound-toggle"
          >
            {soundOn ?
                <Bell className="h-4 w-4 text-sky-500" /> :
                <BellOff className="h-4 w-4" />}
          </button>
          <CockpitQuickCreate />
        </div>
      </div>

      {/* Bulk-merge toolbar (only when there are ≥ 2 mergeable rows) */}
      {mergeRows.length >= 2 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-emerald-500/5 px-3 py-2 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              data-testid="bulk-merge-select-all"
              className="h-3.5 w-3.5"
            />
            <span>
              {t('cockpit.timeline.bulkSelectAll', 'Select all ready (≤ {{n}})', { n: BULK_MERGE_CAP })}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {t('cockpit.timeline.bulkSelected', '{{n}} selected', { n: selectedMerge.size })}
            </span>
            <Button
              size="sm"
              variant="default"
              className="h-7 px-2.5 text-xs"
              disabled={selectedMerge.size === 0 || busy}
              onClick={() => setConfirmBulkOpen(true)}
              data-testid="bulk-merge-trigger"
            >
              {t('cockpit.timeline.bulkMerge', 'Merge {{n}}', { n: selectedMerge.size })}
            </Button>
          </div>
        </div>
      )}

      {/* Timeline list */}
      {isLoading && (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t('common.loading', 'Loading...')}
        </div>
      )}
      {error && (
        <div className="px-3 py-6 text-center text-sm text-rose-500">
          {t('cockpit.timeline.loadError', 'Failed to load timeline')}
        </div>
      )}
      {!isLoading && !error && visible.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 bg-card/20 px-4 py-10 text-center">
          <Bot className="h-6 w-6 text-muted-foreground/60" />
          <div className="text-sm text-muted-foreground">
            {t('cockpit.timeline.empty', 'All caught up — I will speak up when something needs you.')}
          </div>
        </div>
      )}
      <ol className="flex flex-col gap-2">
        {visible.map((msg) => {
          const selectable = msg.kind === 'suggest_merge' && msg.status === 'open' && !!msg.issueId
          const isReplyOpen = replyOpenFor === msg.id
          return (
            <li
              key={msg.id}
              data-testid={`timeline-row-${msg.id}`}
              className={cn(
                'group rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 transition-colors',
                msg.status === 'acknowledged' && 'opacity-60',
              )}
            >
              <div className="flex items-start gap-2.5">
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selectedMerge.has(msg.id)}
                    onChange={() => toggleSelect(msg.id)}
                    data-testid={`bulk-merge-select-${msg.id}`}
                    className="mt-1 h-3.5 w-3.5"
                  />
                )}
                <div className="pt-0.5">{kindIcon(msg.kind)}</div>
                <div className="flex flex-1 flex-col gap-2 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatTime(msg.createdAt)}</span>
                    {msg.kind === 'suggest_merge' && (
                      <span className="rounded-full bg-emerald-500/10 px-1.5 text-emerald-600 dark:text-emerald-400">
                        {t('cockpit.timeline.tag.ready', 'ready')}
                      </span>
                    )}
                    {msg.kind === 'alert_off_track' && (
                      <span className="rounded-full bg-amber-500/10 px-1.5 text-amber-600 dark:text-amber-400">
                        {t('cockpit.timeline.tag.offTrack', 'off-track')}
                      </span>
                    )}
                    {msg.kind === 'suggest_reply' && (
                      <span className="rounded-full bg-sky-500/10 px-1.5 text-sky-600 dark:text-sky-400">
                        {t('cockpit.timeline.tag.awaiting', 'awaiting you')}
                      </span>
                    )}
                    {msg.kind === 'alert_repeat_fail' && (
                      <span className="rounded-full bg-rose-500/10 px-1.5 text-rose-600 dark:text-rose-400">
                        {t('cockpit.timeline.tag.repeatFail', 'failing')}
                      </span>
                    )}
                    {msg.kind === 'alert_stale_working' && (
                      <span className="rounded-full bg-violet-500/10 px-1.5 text-violet-600 dark:text-violet-400">
                        {t('cockpit.timeline.tag.stale', 'stuck')}
                      </span>
                    )}
                    {/* Enrichment rung badge — observability for the
                        decision-card degradation chain (COCKPIT-008). */}
                    {msg.enrichmentStatus === 'enriched' && (
                      <span className="rounded-full bg-primary/10 px-1.5 text-primary">
                        {t('cockpit.timeline.badge.enriched', 'enriched')}
                      </span>
                    )}
                    {msg.enrichmentStatus === 'structured' && (
                      <span className="rounded-full bg-muted px-1.5 text-muted-foreground">
                        {t('cockpit.timeline.badge.options', 'options')}
                      </span>
                    )}
                    {msg.enrichmentError && (
                      <span
                        title={msg.enrichmentError}
                        className="rounded-full bg-amber-500/10 px-1.5 text-amber-600 dark:text-amber-400"
                      >
                        {t('cockpit.timeline.badge.enrichFailed', 'AI failed')}
                      </span>
                    )}
                  </div>
                  <div className="text-sm leading-relaxed text-foreground/90 break-words">
                    {msg.body}
                  </div>
                  {msg.recommendation && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{msg.recommendation.reasoning}</span>
                    </div>
                  )}
                  {(msg.actions.length > 0 || (!!msg.issueId && !!msg.projectId)) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {msg.actions.map((action) => {
                        // Snooze gets a dropdown with 3 presets instead
                        // of a single fixed button — see M3.
                        if (action.kind === 'snooze') {
                          return (
                            <DropdownMenu key={action.id}>
                              <DropdownMenuTrigger
                                render={({ ...triggerProps }) => (
                                  <Button
                                    {...triggerProps}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-xs"
                                    disabled={busy}
                                    data-testid={`snooze-trigger-${msg.id}`}
                                  >
                                    <Clock className="mr-1 h-3 w-3" />
                                    {t('cockpit.timeline.snoozeLabel', 'Snooze')}
                                  </Button>
                                )}
                              />
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() => snooze.mutate({ id: msg.id, untilMs: Date.now() + HOUR_MS })}
                                  data-testid={`snooze-1h-${msg.id}`}
                                >
                                  {t('cockpit.timeline.snooze1h', '1 hour')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => snooze.mutate({ id: msg.id, untilMs: Date.now() + 4 * HOUR_MS })}
                                  data-testid={`snooze-4h-${msg.id}`}
                                >
                                  {t('cockpit.timeline.snooze4h', '4 hours')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => snooze.mutate({ id: msg.id, untilMs: endOfTodayMs() })}
                                  data-testid={`snooze-today-${msg.id}`}
                                >
                                  {t('cockpit.timeline.snoozeToday', 'Until tonight')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )
                        }
                        return (
                          <Button
                            key={action.id}
                            size="sm"
                            variant={
                              action.tone === 'primary' ? 'default' :
                                action.tone === 'danger' ? 'destructive' :
                                  'outline'
                            }
                            className="h-7 px-2.5 text-xs"
                            disabled={busy}
                            onClick={() => runAction(msg, action)}
                          >
                            {action.kind === 'dismiss' && <X className="mr-1 h-3 w-3" />}
                            {action.kind === 'reply-input' && <MessageSquare className="mr-1 h-3 w-3" />}
                            {action.kind === 'reply-preset' && <Send className="mr-1 h-3 w-3" />}
                            {action.label}
                          </Button>
                        )
                      })}
                      {!!msg.issueId && !!msg.projectId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          disabled={busy}
                          onClick={() => setForkFor(msg)}
                          data-testid={`fork-trigger-${msg.id}`}
                        >
                          <GitBranch className="mr-1 h-3 w-3" />
                          {t('chat.fork.cta')}
                        </Button>
                      )}
                    </div>
                  )}
                  {isReplyOpen && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <Textarea
                        value={replyDraft}
                        onChange={e => setReplyDraft(e.target.value)}
                        placeholder={t('cockpit.timeline.replyPlaceholder', 'Type your reply…')}
                        rows={3}
                        className="text-sm"
                        autoFocus
                        data-testid={`reply-input-${msg.id}`}
                      />
                      <div className="flex items-center gap-1.5 self-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => {
                            setReplyOpenFor(null); setReplyDraft('')
                          }}
                        >
                          {t('common.cancel', 'Cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 px-2.5 text-xs"
                          disabled={busy || replyDraft.trim().length === 0}
                          onClick={() => submitReply(msg)}
                          data-testid={`reply-send-${msg.id}`}
                        >
                          <Send className="mr-1 h-3 w-3" />
                          {t('cockpit.timeline.replySend', 'Send')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {(counts.suggest_merge + counts.alert_off_track + counts.suggest_reply + counts.alert_repeat_fail) === 0 && !isLoading && (
        <div className="text-center text-xs text-muted-foreground/60">
          {t('cockpit.timeline.hint', 'I read each issue as it settles and post here. Press / to drop a new issue.')}
        </div>
      )}

      {/* Bulk-merge confirmation */}
      <AlertDialog open={confirmBulkOpen} onOpenChange={setConfirmBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('cockpit.timeline.bulkConfirmTitle', 'Merge {{n}} issues?', { n: selectedMerge.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'cockpit.timeline.bulkConfirmBody',
                'These issues will move from review to done. The working tree stays dirty — commit / push is still your job. Diff overlap is not detected; sequential approval may entangle related diffs.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-card/30 px-3 py-2 text-xs">
            {visible.filter(m => selectedMerge.has(m.id)).map(m => (
              <li key={m.id} className="py-0.5 text-foreground/90 truncate">
                {m.body}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={runBulkMerge}
              data-testid="bulk-merge-confirm"
            >
              {t('cockpit.timeline.bulkMergeConfirm', 'Move to done')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fork an issue from a timeline message (whole-issue fork).
          Kept always-mounted — conditionally unmounting a modal the instant
          it closes skips the dialog's scroll-lock cleanup and freezes page
          scrolling. */}
      <ForkDialog
        open={!!forkFor}
        onOpenChange={(o) => {
          if (!o) setForkFor(null)
        }}
        issueId={forkFor?.issueId ?? ''}
        projectId={forkFor?.projectId ?? ''}
      />
    </div>
  )
}

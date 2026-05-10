import { CornerUpLeft, MessageSquareText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedLogEntry } from '@/types/kanban'

/**
 * Sticky banner pinned to the top of the chat scroll area that shows the
 * user prompt of the turn the reader is currently viewing.
 *
 * Hides when:
 *   - There are fewer than two trackable prompts (nothing to disambiguate).
 *   - The active prompt is itself in the viewport.
 *   - The user is above the first prompt (no answer is being read yet).
 *
 * Detection: scan all `[data-user-turn]` anchors inside scrollRef on every
 * scroll (rAF-throttled). The "active" prompt is the most recent anchor
 * whose bottom edge has scrolled past the container's top edge. The same
 * rule works for both `messages.map()` and the virtualized list — the
 * virtualizer's `overscan` keeps the topmost relevant anchor mounted.
 */
export function CurrentPromptHover({
  logs,
  scrollRef,
}: {
  logs: NormalizedLogEntry[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()

  // Build turn → user-message-entry map directly from logs. Only includes
  // "normal" user messages — pending / done bubbles bypass the message
  // list and aren't anchored, so they'd never be active anyway.
  const promptByTurn = useMemo(() => {
    const map = new Map<number, NormalizedLogEntry>()
    for (const entry of logs) {
      if (entry.entryType !== 'user-message') continue
      const metaType = entry.metadata?.type
      if (metaType === 'pending' || metaType === 'done') continue
      const turn = entry.turnIndex
      if (typeof turn !== 'number') continue
      map.set(turn, entry)
    }
    return map
  }, [logs])

  const promptCount = promptByTurn.size

  const [activeTurn, setActiveTurn] = useState<number | null>(null)
  const rafIdRef = useRef(0)

  useEffect(() => {
    if (promptCount < 2) {
      setActiveTurn(null)
      return
    }
    const el = scrollRef.current
    if (!el) return

    const measure = () => {
      rafIdRef.current = 0
      const containerTop = el.getBoundingClientRect().top
      const anchors = el.querySelectorAll<HTMLElement>('[data-user-turn]')
      let active: number | null = null
      let activeStillVisible = false
      for (const node of anchors) {
        const turnAttr = node.dataset.userTurn
        if (!turnAttr) continue
        const turn = Number(turnAttr)
        if (!Number.isFinite(turn)) continue
        const rect = node.getBoundingClientRect()
        // Bottom edge above container top → fully scrolled past. Mark as
        // active and keep walking; later anchors may also be above the
        // top, in which case the latest one wins.
        if (rect.bottom <= containerTop + 1) {
          active = turn
          activeStillVisible = false
          continue
        }
        // Anchor still partially / fully visible. If it's the one we
        // just marked active, treat it as still-in-view and clear.
        if (active === turn) {
          activeStillVisible = true
        }
        break
      }
      setActiveTurn(activeStillVisible ? null : active)
    }

    const onScroll = () => {
      if (rafIdRef.current) return
      rafIdRef.current = requestAnimationFrame(measure)
    }

    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = 0
      }
    }
  }, [scrollRef, promptCount, logs])

  if (activeTurn === null) return null
  const active = promptByTurn.get(activeTurn)
  if (!active) return null

  const attachments = (active.metadata?.attachments ?? []) as Array<{
    name: string
  }>
  const rawContent = active.content
    .replace(/\n*--- Attached files ---\n(?:\[Attached file:.*\]\n?)*/g, '')
    .trim()
  const display = rawContent || (attachments.length > 0
    ? attachments.map(a => a.name).join(', ')
    : '')
  if (!display) return null

  const handleJump = () => {
    const el = scrollRef.current
    if (!el) return
    const anchor = el.querySelector<HTMLElement>(
      `[data-user-turn="${activeTurn}"]`,
    )
    anchor?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={handleJump}
      title={display}
      aria-label={`${t('chat.currentPrompt.viewing')} — ${display}`}
      className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-background/85 backdrop-blur-md shadow-sm px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/40"
    >
      <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground/80">
        {t('chat.currentPrompt.viewing')}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {display}
      </span>
      <CornerUpLeft className="h-3 w-3 shrink-0 text-muted-foreground/60" />
    </button>
  )
}

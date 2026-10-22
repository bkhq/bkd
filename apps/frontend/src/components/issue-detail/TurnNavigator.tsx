import type { ChatTurn } from './turn-navigator'
import { cn } from 'cn'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

/** Jumping further back than this many unloaded entries asks first. */
const FAR_JUMP_ENTRIES = 1000

/**
 * Vertical rail with one tick per conversation turn. Hovering a tick previews
 * the turn; clicking it jumps there, loading history first for unloaded turns.
 */
export function TurnNavigator({
  turns,
  activeIndex,
  loadedEntries = 0,
  onJump,
}: {
  turns: ChatTurn[]
  /** Message index of the turn in view */
  activeIndex: number
  /** Log entries currently loaded, to estimate how much a jump loads */
  loadedEntries?: number
  onJump: (turn: ChatTurn) => unknown
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLElement>(null)
  const [preview, setPreview] = useState<{ turn: ChatTurn, top: number } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [confirmTurn, setConfirmTurn] = useState<ChatTurn | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  // Ticks that do not fit stay in a scrolling rail; the buttons page through it.
  const [paging, setPaging] = useState({ overflow: false, canUp: false, canDown: false })

  const syncPaging = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const overflow = rail.scrollHeight > rail.clientHeight + 1
    const canUp = overflow && rail.scrollTop > 0
    const canDown = overflow && rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1
    setPaging(p => (p.overflow === overflow && p.canUp === canUp && p.canDown === canDown ? p : { overflow, canUp, canDown }))
  }, [])

  useLayoutEffect(() => {
    syncPaging()
    const rail = railRef.current
    if (!rail || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncPaging)
    observer.observe(rail)
    return () => observer.disconnect()
  }, [syncPaging, turns.length])

  // When the turn in view changes and its tick is outside the rail, center it,
  // so the highlight never sits in the hidden part. Paging leaves it alone.
  useEffect(() => {
    const rail = railRef.current
    const tick = rail?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!rail || !tick) return
    const top = tick.offsetTop
    const bottom = top + tick.offsetHeight
    if (top >= rail.scrollTop && bottom <= rail.scrollTop + rail.clientHeight) return
    const max = Math.max(0, rail.scrollHeight - rail.clientHeight)
    rail.scrollTop = Math.min(max, Math.max(0, top + tick.offsetHeight / 2 - rail.clientHeight / 2))
    syncPaging()
  }, [activeIndex, syncPaging])

  const page = (direction: 1 | -1) => {
    const rail = railRef.current
    if (!rail) return
    const max = Math.max(0, rail.scrollHeight - rail.clientHeight)
    rail.scrollTop = Math.min(max, Math.max(0, rail.scrollTop + direction * rail.clientHeight * 0.8))
    syncPaging()
  }

  if (turns.length < 2) return null

  const jump = (turn: ChatTurn) => {
    setLoadingId(turn.messageId)
    void Promise.resolve(onJump(turn)).finally(() => setLoadingId(null))
  }

  const requestJump = (turn: ChatTurn) => {
    const toLoad = turn.index === null ? (turn.entriesSince ?? 0) - loadedEntries : 0
    if (toLoad > FAR_JUMP_ENTRIES) setConfirmTurn(turn)
    else jump(turn)
  }

  const showPreview = (turn: ChatTurn, tick: HTMLElement) => {
    const root = rootRef.current
    if (!root) return
    const rect = tick.getBoundingClientRect()
    setPreview({ turn, top: rect.top + rect.height / 2 - root.getBoundingClientRect().top })
  }

  return (
    <nav
      ref={rootRef}
      aria-label={t('session.turnNavigator')}
      className="pointer-events-none absolute inset-y-[20%] right-1.5 z-10 hidden items-center md:flex"
    >
      <div className="pointer-events-auto flex max-h-full flex-col items-end">
        {paging.overflow
          ? <RailPageButton direction="up" disabled={!paging.canUp} label={t('session.earlierTurns')} onClick={() => page(-1)} />
          : null}
        <div
          ref={railRef}
          data-testid="turn-rail"
          onScroll={syncPaging}
          className="relative flex min-h-0 flex-col items-end overflow-y-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {turns.map((turn, i) => {
            const active = turn.index === activeIndex
            return (
              <button
                key={turn.messageId}
                type="button"
                aria-label={t('session.jumpToTurn', { n: i + 1 })}
                aria-current={active ? 'true' : undefined}
                aria-busy={loadingId === turn.messageId || undefined}
                onClick={() => requestJump(turn)}
                onMouseEnter={e => showPreview(turn, e.currentTarget)}
                onMouseLeave={() => setPreview(null)}
                onFocus={e => showPreview(turn, e.currentTarget)}
                onBlur={() => setPreview(null)}
                className="group flex shrink-0 items-center justify-end py-[3px] pl-2"
              >
                <span
                  className={cn(
                    'h-[2px] w-2.5 rounded-full transition-[width] duration-150 group-hover:w-4',
                    active ? 'bg-foreground' : 'bg-muted-foreground/40 group-hover:bg-foreground/70',
                    loadingId === turn.messageId && 'animate-pulse',
                  )}
                />
              </button>
            )
          })}
        </div>
        {paging.overflow
          ? <RailPageButton direction="down" disabled={!paging.canDown} label={t('session.laterTurns')} onClick={() => page(1)} />
          : null}
      </div>
      {preview ?
          (
            <div
              className="pointer-events-none absolute right-full mr-2 w-72 -translate-y-1/2 rounded-lg border border-border/50 bg-background/95 px-3 py-2.5 shadow-md backdrop-blur-sm"
              style={{ top: preview.top }}
            >
              <p className="line-clamp-2 text-sm font-semibold text-foreground">{preview.turn.userText}</p>
              {preview.turn.replyText ?
                  (
                    <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{preview.turn.replyText}</p>
                  ) :
                null}
            </div>
          ) :
        null}
      <AlertDialog open={!!confirmTurn} onOpenChange={open => !open && setConfirmTurn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('session.loadHistoryTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('session.loadHistoryDescription', {
                count: Math.max(0, (confirmTurn?.entriesSince ?? 0) - loadedEntries),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTurn) jump(confirmTurn)
                setConfirmTurn(null)
              }}
            >
              {t('session.loadHistoryConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  )
}

/** Pages the turn rail up or down; disabled at that end. */
function RailPageButton({ direction, disabled, label, onClick }: {
  direction: 'up' | 'down'
  disabled: boolean
  label: string
  onClick: () => void
}) {
  const Icon = direction === 'up' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon className="size-3.5" />
    </button>
  )
}

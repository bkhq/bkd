import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { kanbanApi } from '@/lib/kanban-api'
import { useChatSearchStore } from '@/stores/chat-search-store'

interface SearchHit {
  logId: string
  issueId: string
  entryType: string
  content: string
  createdAt: string
  score: number
}

interface ChatSearchBarProps {
  issueId: string
  /** Pulls the window around a log id into the stream so it can be scrolled to. */
  loadLogWindow: (logId: string) => Promise<boolean>
  onClose: () => void
  /** Whether the search panel is currently open. */
  open: boolean
}

/**
 * Sticky in-chat full-text search bar (SEARCH-001 / PLAN-019).
 *
 * - Queries `/api/search/logs?issueId=...` with the bigram FTS5 index.
 * - Renders a ranked dropdown of hits with content snippets.
 * - Clicking a hit loads the window around it via `loadLogWindow` and then
 *   asks the message list (through `chat-search-store`) to scroll the
 *   matching bubble into view and flash-highlight it — even when the hit
 *   is far outside the currently loaded history.
 */
export function ChatSearchBar({ issueId, loadLogWindow, onClose, open }: ChatSearchBarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const requestJump = useChatSearchStore(s => s.requestJump)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [jumping, setJumping] = useState(false)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open, issueId])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits(null)
      setActive(0)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 1) {
      setHits(null)
      return
    }
    const timer = setTimeout(() => {
      setLoading(true)
      kanbanApi
        .searchLogs(q, 50, { issueId })
        .then((data) => {
          setHits(data)
          setActive(0)
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false))
    }, 220)
    return () => clearTimeout(timer)
  }, [query, issueId, open])

  const total = hits?.length ?? 0

  const jumpTo = useCallback(async (index: number) => {
    if (!hits || hits.length === 0) return
    const safe = ((index % hits.length) + hits.length) % hits.length
    setActive(safe)
    const hit = hits[safe]!
    setJumping(true)
    try {
      const ready = await loadLogWindow(hit.logId)
      if (!ready) {
        toast.error(t('chat.search.jumpFailed', '无法跳转到该消息'))
        return
      }
      // Hand off to the message list — it owns the virtualizer and is the
      // only place that can reliably scroll a virtualized row into view.
      requestJump(hit.logId)
    } finally {
      setJumping(false)
    }
  }, [hits, loadLogWindow, requestJump, t])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (total > 0) jumpTo(e.shiftKey ? active - 1 : active + 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (total > 0) jumpTo(active + 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (total > 0) jumpTo(active - 1)
    }
  }

  const counter = useMemo(() => {
    if (loading) return '…'
    if (hits === null) return ''
    if (total === 0) return t('chat.search.empty', '无结果')
    return `${active + 1}/${total}`
  }, [loading, hits, total, active, t])

  if (!open) return null

  return (
    <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.search.placeholder', '搜索当前对话…')}
          className="h-7 flex-1 text-sm"
        />
        <span className="text-xs text-muted-foreground tabular-nums min-w-[3.5rem] text-right">
          {counter}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={total === 0 || jumping}
          onClick={() => jumpTo(active - 1)}
          title={t('chat.search.prev', '上一个')}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={total === 0 || jumping}
          onClick={() => jumpTo(active + 1)}
          title={t('chat.search.next', '下一个')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          title={t('chat.search.close', '关闭 (Esc)')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {hits && hits.length > 0
        ? (
            <div className="max-h-56 overflow-y-auto border-t border-border/40">
              {hits.map((hit, idx) => (
                <button
                  key={hit.logId}
                  type="button"
                  onClick={() => jumpTo(idx)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/40 transition-colors border-l-2 ${
                    idx === active ? 'border-yellow-400 bg-muted/30' : 'border-transparent'
                  }`}
                >
                  <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                    {hit.entryType.replace('-message', '')}
                  </span>
                  <span className="text-foreground/80">
                    {hit.content.slice(0, 200)}
                  </span>
                </button>
              ))}
            </div>
          )
        : null}
    </div>
  )
}

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { kanbanApi } from '@/lib/kanban-api'

interface SearchHit {
  logId: string
  issueId: string
  entryType: string
  content: string
  createdAt: string
  score: number
}

interface ChatSearchBarProps {
  projectId: string
  issueId: string
  scrollRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  /** Whether the search panel is currently open. */
  open: boolean
}

/**
 * Sticky in-chat full-text search bar (SEARCH-001 / PLAN-019).
 *
 * - Queries `/api/search/logs?issueId=...` with the bigram FTS5 index.
 * - Renders a ranked dropdown of hits with content snippets.
 * - Clicking a hit scrolls to the matching message bubble; rows not in the
 *   loaded window are pulled in via the `/logs/around/:logId` endpoint
 *   (V1 falls back to "load more history" when no merge API is exposed).
 */
export function ChatSearchBar({ projectId, issueId, scrollRef, onClose, open }: ChatSearchBarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)

  // Reset state when issue changes or closed
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
    const t = setTimeout(() => {
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
    return () => clearTimeout(t)
  }, [query, issueId, open])

  const total = hits?.length ?? 0

  const jumpTo = useCallback(async (index: number) => {
    if (!hits || hits.length === 0) return
    const safe = ((index % hits.length) + hits.length) % hits.length
    setActive(safe)
    const hit = hits[safe]!
    const root = scrollRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(hit.logId)}"]`,
    )
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('ring-2', 'ring-yellow-400', 'rounded-md')
      setTimeout(() => {
        target.classList.remove('ring-2', 'ring-yellow-400', 'rounded-md')
      }, 1600)
      return
    }
    // Not in DOM — pull the window around this log so the bubble exists
    // before we scroll. (V1: best-effort; if the merge API isn't wired
    // we surface a hint so the user can load older history manually.)
    try {
      await kanbanApi.getLogsAround(projectId, issueId, hit.logId, 20)
      toast.info(t('chat.search.scrollUpHint', '请向上滚动以加载更多历史，然后再点击'))
    } catch {
      toast.error(t('chat.search.jumpFailed', '无法跳转到该消息'))
    }
  }, [hits, scrollRef, projectId, issueId, t])

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
          disabled={total === 0}
          onClick={() => jumpTo(active - 1)}
          title={t('chat.search.prev', '上一个')}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={total === 0}
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

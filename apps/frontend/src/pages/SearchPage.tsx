import { ArrowLeft, FileSearch, Search, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppSettingsDialog } from '@/components/AppSettingsDialog'
import { kanbanApi } from '@/lib/kanban-api'
import { queryKeys } from '@/hooks/use-kanban'

interface LogSearchHit {
  logId: string
  issueId: string
  issueTitle: string
  projectAlias: string
  projectName: string
  entryType: string
  content: string
  createdAt: string
  score: number
}

function highlightMatches(text: string, query: string): React.ReactNode[] {
  if (!query.trim()) return [text]
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="rounded-sm bg-yellow-200 text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-200 px-0.5">{part}</mark>
      : part,
  )
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  'assistant-message': 'Assistant',
  'user-message': 'User',
  'thinking': 'Thinking',
  'tool-use': 'Tool',
  'system-message': 'System',
  'error-message': 'Error',
}

function SearchResult({ hit, query, onClick }: { hit: LogSearchHit, query: string, onClick: () => void }) {
  const preview = hit.content.length > 200 ? `${hit.content.slice(0, 200)}…` : hit.content
  const typeLabel = ENTRY_TYPE_LABELS[hit.entryType] ?? hit.entryType
  const time = useMemo(() => {
    try {
      const d = new Date(hit.createdAt)
      return d.toLocaleString()
    } catch {
      return hit.createdAt
    }
  }, [hit.createdAt])

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 w-full px-4 py-3 text-left border-b border-border/50 hover:bg-muted/40 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-2 w-full min-w-0">
        <FileSearch className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm truncate">{hit.issueTitle}</span>
        <span className="shrink-0 text-[10px] font-mono bg-muted/60 rounded px-1.5 py-0.5 text-muted-foreground">
          {hit.projectName}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px]">{typeLabel}</span>
        <span>{time}</span>
      </div>
      <p className="text-xs text-muted-foreground/90 leading-relaxed line-clamp-3 break-words w-full">
        {highlightMatches(preview, query)}
      </p>
    </button>
  )
}

export default function SearchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleChange = useCallback((value: string) => {
    setQuery(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQuery(value.trim()), 250)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const searchEnabled = debouncedQuery.length >= 1

  const { data: hits, isLoading } = useQuery({
    queryKey: queryKeys.logSearch(debouncedQuery),
    queryFn: () => kanbanApi.searchLogs(debouncedQuery, 50),
    enabled: searchEnabled,
    staleTime: 5000,
  })

  const showEmpty = searchEnabled && !isLoading && hits && hits.length === 0
  const showResults = searchEnabled && hits && hits.length > 0

  const handleResultClick = useCallback((hit: LogSearchHit) => {
    navigate(`/projects/${hit.projectAlias}/issues/${hit.issueId}`)
  }, [navigate])

  return (
    <div className="flex h-full flex-col bg-background text-foreground animate-page-enter">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 active:bg-accent transition-colors"
          aria-label={t('common.cancel', '返回')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleChange(e.target.value)}
            placeholder={t('search.placeholder', '搜索所有对话日志…')}
            className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-4 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
          />
        </div>
        {isLoading && (
          <span className="text-xs text-muted-foreground animate-pulse">{t('common.loading', '…')}</span>
        )}
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 active:bg-accent transition-colors"
          aria-label={t('sidebar.settings')}
          title={t('sidebar.settings')}
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!searchEnabled && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/50">
            <Search className="h-10 w-10" />
            <span className="text-sm">{t('search.typeToSearch', '输入关键词搜索所有项目中的对话日志')}</span>
          </div>
        )}

        {showEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/50">
            <FileSearch className="h-10 w-10" />
            <span className="text-sm">{t('search.noResults', '无结果')}</span>
          </div>
        )}

        {showResults && (
          <div className="divide-y divide-border/30">
            <div className="px-4 py-2 text-[11px] text-muted-foreground/60 border-b border-border/20">
              {t('search.foundNResults', '找到 {{count}} 条结果', { count: hits!.length })}
            </div>
            {hits!.map((hit: LogSearchHit) => (
              <SearchResult
                key={hit.logId}
                hit={hit}
                query={debouncedQuery}
                onClick={() => handleResultClick(hit)}
              />
            ))}
          </div>
        )}
      </div>
      <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  )
}

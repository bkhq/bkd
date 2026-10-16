import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIssueSearch } from '@/hooks/use-kanban'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

/** Issues whose chat messages match the search box, minus those already listed. */
export function IssueMessageMatches({
  projectId,
  query,
  excludeIds,
  onNavigate,
}: {
  projectId: string
  query: string
  excludeIds: Set<string>
  onNavigate: (issueId: string) => void
}) {
  const { t } = useTranslation()
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const timer = setTimeout(setDebounced, DEBOUNCE_MS, query)
    return () => clearTimeout(timer)
  }, [query])

  const { data } = useIssueSearch(projectId, debounced, debounced.length >= MIN_QUERY_LENGTH)
  const hits = query.length >= MIN_QUERY_LENGTH
    ? (data ?? []).filter(hit => !excludeIds.has(hit.issue.id))
    : []
  if (hits.length === 0) return null

  return (
    <div>
      <div className="sticky top-0 z-10 flex h-8 items-center gap-1.5 border-b border-border/20 bg-secondary px-2.5 text-xs">
        <span className="truncate font-semibold tracking-tight text-foreground/85">
          {t('issue.messageMatches')}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground/60">
          (
          {hits.length}
          )
        </span>
      </div>
      {hits.map(hit => (
        <button
          key={hit.issue.id}
          type="button"
          onClick={() => onNavigate(hit.issue.id)}
          className="flex w-full flex-col gap-0.5 px-2.5 py-2.5 text-left transition-colors duration-150 hover:bg-accent/60 md:py-1.5"
        >
          <span className="flex w-full items-center gap-1.5">
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
              #
              {hit.issue.issueNumber}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">{hit.issue.title}</span>
          </span>
          <span className="line-clamp-2 text-[11px] text-muted-foreground">
            <Highlight text={hit.snippet} query={debounced} />
          </span>
        </button>
      ))}
    </div>
  )
}

function Highlight({ text, query }: { text: string, query: string }) {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, i) =>
    // Odd indexes are the captured matches.
    i % 2 === 1
      ? <mark key={i} className="rounded-sm bg-primary/20 text-foreground">{part}</mark>
      : part,
  )
}

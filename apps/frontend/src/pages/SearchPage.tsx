import { ArrowLeft, Search } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { SearchContent } from '@/components/search/SearchContent'

export default function SearchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const handleSelect = useCallback(() => {
    navigate(-1)
  }, [navigate])

  return (
    <div className="flex h-full flex-col bg-background text-foreground animate-page-enter">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 active:bg-accent transition-colors"
          aria-label={t('common.cancel', '返回')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Search className="h-4 w-4" />
          <span>{t('search.title', '搜索')}</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-2 py-2">
        <SearchContent onSelect={handleSelect} autoFocus />
      </div>
    </div>
  )
}

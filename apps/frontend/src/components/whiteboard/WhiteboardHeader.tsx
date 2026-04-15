import { ArrowLeft, MessageSquare, Plus, RotateCcw, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

interface WhiteboardHeaderProps {
  projectId: string
  projectName: string
  onCreateRoot: () => void
  onReset: () => void
  hasNodes: boolean
  boundIssueId: string | null
  onToggleChat: () => void
}

export function WhiteboardHeader({ projectId, projectName, onCreateRoot, onReset, hasNodes, boundIssueId, onToggleChat }: WhiteboardHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [topic, setTopic] = useState('')

  const handleGenerate = useCallback(() => {
    const trimmed = topic.trim()
    if (!trimmed) return
    window.dispatchEvent(new CustomEvent('wb:generate-tree', { detail: { topic: trimmed } }))
    setTopic('')
  }, [topic])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleGenerate()
    }
  }, [handleGenerate])

  const handleBack = useCallback(() => {
    // Go back to previous page if possible, otherwise fall back to project page
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate(`/projects/${projectId}`)
    }
  }, [navigate, projectId])

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={handleBack}
        title={t('whiteboard.backToBoard')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{projectName}</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">{t('whiteboard.title')}</span>
      </div>
      <div className="mx-4 flex flex-1 max-w-sm items-center gap-2 rounded-md border bg-background px-3 py-1">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={t('whiteboard.generatePlaceholder')}
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {topic.trim() && (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={handleGenerate}
          >
            {t('whiteboard.generate')}
          </button>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {boundIssueId && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleChat}
            title={t('whiteboard.viewChat')}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}
        {hasNodes && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onReset}
            title={t('whiteboard.reset')}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        {!hasNodes && (
          <Button size="sm" onClick={onCreateRoot}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('whiteboard.createRoot')}
          </Button>
        )}
      </div>
    </header>
  )
}

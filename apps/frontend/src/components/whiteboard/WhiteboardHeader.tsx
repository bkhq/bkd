import { ArrowLeft, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

interface WhiteboardHeaderProps {
  projectId: string
  projectName: string
  onCreateRoot: () => void
  hasNodes: boolean
}

export function WhiteboardHeader({ projectId, projectName, onCreateRoot, hasNodes }: WhiteboardHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => navigate(`/projects/${projectId}`)}
        title={t('whiteboard.backToBoard')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{projectName}</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">{t('whiteboard.title')}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
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

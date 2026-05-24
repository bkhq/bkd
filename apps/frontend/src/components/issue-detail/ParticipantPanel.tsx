import { useTranslation } from 'react-i18next'
import { Plus, User } from 'lucide-react'
import { useRoles } from '@/hooks/use-kanban'

interface ParticipantPanelProps {
  projectId: string
  issueId: string
  onCreateRole: () => void
}

export function ParticipantPanel({ projectId, issueId: _issueId, onCreateRole }: ParticipantPanelProps) {
  const { t } = useTranslation()
  const { data: roles, isLoading } = useRoles(projectId)

  if (isLoading) {
    return (
      <div className="w-48 border-l border-border bg-muted/30 p-4">
        <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="w-48 border-l border-border bg-muted/30 p-4 flex flex-col shrink-0">
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
        {t('role.participants', 'Participants')}
      </h3>

      {/* User */}
      <div className="flex items-center gap-2 mb-2 p-2 rounded hover:bg-accent transition-colors">
        <User className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm">{t('role.you', 'You')}</span>
      </div>

      {/* Role list */}
      <div className="flex-1 overflow-auto">
        {roles?.map(role => (
          <div
            key={role.id}
            className="flex items-center gap-2 mb-1 p-2 rounded hover:bg-accent transition-colors"
          >
            <span className="text-lg">{role.avatar || '🤖'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{role.displayName}</div>
              <div className="text-xs text-muted-foreground">
                {role.type === 'internal' ? t('role.internal', 'Internal') : t('role.external', 'External')}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add role button */}
      <button
        type="button"
        className="w-full mt-2 py-2 text-sm text-primary hover:bg-primary/10 rounded border border-dashed border-border flex items-center justify-center gap-1 transition-colors"
        onClick={onCreateRole}
      >
        <Plus className="w-4 h-4" />
        {t('role.addRole', 'Add Role')}
      </button>
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, User, X } from 'lucide-react'
import { useAssignRole, useIssueRoles, useRemoveRole, useRoles } from '@/hooks/use-kanban'

interface ParticipantPanelProps {
  projectId: string
  issueId: string
}

export function ParticipantPanel({ projectId, issueId }: ParticipantPanelProps) {
  const { t } = useTranslation()
  const { data: assignedRoles, isLoading } = useIssueRoles(projectId, issueId)
  const { data: allRoles } = useRoles(projectId)
  const assignRole = useAssignRole(projectId, issueId)
  const removeRole = useRemoveRole(projectId, issueId)
  const [showAddRole, setShowAddRole] = useState(false)

  const availableRoles = allRoles?.filter(
    role => !assignedRoles?.some(ar => ar.id === role.id),
  )

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
        {t('chat.participants', 'Participants')}
      </h3>

      <div className="flex items-center gap-2 mb-2 p-2 rounded hover:bg-accent transition-colors">
        <User className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm">{t('role.you', 'You')}</span>
      </div>

      <div className="flex-1 overflow-auto space-y-1">
        {assignedRoles?.map(role => (
          <div
            key={role.id}
            className="flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors group"
          >
            <span className="text-lg">{role.avatar || '🤖'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{role.displayName}</div>
              <div className="text-xs text-muted-foreground">
                @
                {role.name}
              </div>
            </div>
            <button
              onClick={() => removeRole.mutate(role.id)}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-opacity"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>

      {showAddRole ? (
        <div className="mt-2 space-y-1">
          {availableRoles?.map(role => (
            <button
              key={role.id}
              onClick={() => {
                assignRole.mutate(role.id)
                setShowAddRole(false)
              }}
              className="w-full flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors text-left"
            >
              <span className="text-lg">{role.avatar || '🤖'}</span>
              <span className="text-sm">{role.displayName}</span>
            </button>
          ))}
          <button
            onClick={() => setShowAddRole(false)}
            className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddRole(true)}
          className="w-full mt-2 py-2 text-sm text-primary hover:bg-primary/10 rounded border border-dashed border-border flex items-center justify-center gap-1 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('role.addRole', 'Add Role')}
        </button>
      )}
    </div>
  )
}

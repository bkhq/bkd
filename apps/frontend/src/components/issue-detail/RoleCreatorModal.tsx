import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useCreateRole } from '@/hooks/use-kanban'

interface RoleCreatorModalProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function RoleCreatorModal({ projectId, isOpen, onClose, onSuccess }: RoleCreatorModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [avatar, setAvatar] = useState('🤖')
  const [type, setType] = useState<'internal' | 'external'>('internal')
  const [issueId, setIssueId] = useState('')
  const [endpoint, setEndpoint] = useState('')

  const createRole = useCreateRole(projectId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const data: {
      name: string
      displayName: string
      description?: string
      avatar?: string
      type: 'internal' | 'external'
      issueId?: string
      endpoint?: string
      protocol?: 'http' | 'mcp'
    } = {
      name,
      displayName,
      description: description || undefined,
      avatar: avatar || undefined,
      type,
    }

    if (type === 'internal') {
      data.issueId = issueId || undefined
    } else {
      data.endpoint = endpoint || undefined
      data.protocol = 'http'
    }

    await createRole.mutateAsync(data)
    onSuccess?.()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-popover rounded-lg p-6 w-96 max-h-[90vh] overflow-auto shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('role.createTitle', 'Create Role')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('role.nameLabel', 'Name (for @)')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded bg-background"
              placeholder="frontend"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('role.displayNameLabel', 'Display Name')}</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded bg-background"
              placeholder={t('role.displayNamePlaceholder', 'Frontend Expert')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('role.descriptionLabel', 'Description')}</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded bg-background"
              placeholder={t('role.descriptionPlaceholder', 'Optional description')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('role.avatarLabel', 'Avatar')}</label>
            <input
              type="text"
              value={avatar}
              onChange={e => setAvatar(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded bg-background"
              maxLength={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('role.typeLabel', 'Type')}</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="internal"
                  checked={type === 'internal'}
                  onChange={() => setType('internal')}
                />
                <span className="text-sm">{t('role.internalType', 'Internal (linked to issue)')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  value="external"
                  checked={type === 'external'}
                  onChange={() => setType('external')}
                />
                <span className="text-sm">{t('role.externalType', 'External (local agent)')}</span>
              </label>
            </div>
          </div>

          {type === 'internal' ? (
            <div>
              <label className="block text-sm font-medium mb-1">{t('role.issueIdLabel', 'Linked Issue ID')}</label>
              <input
                type="text"
                value={issueId}
                onChange={e => setIssueId(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded bg-background"
                placeholder="issue-xxx"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">{t('role.endpointLabel', 'Endpoint')}</label>
              <input
                type="text"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded bg-background"
                placeholder="http://localhost:3001"
              />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-input rounded hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              disabled={createRole.isPending}
            >
              {createRole.isPending ? t('role.creating', 'Creating...') : t('role.create', 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

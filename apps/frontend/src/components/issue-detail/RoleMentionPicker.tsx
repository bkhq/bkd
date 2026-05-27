import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoles } from '@/hooks/use-kanban'
import type { Role } from '@/lib/kanban-api'

interface RoleMentionPickerProps {
  projectId: string
  query: string
  onSelect: (role: Role | null) => void
  onCreateNew: () => void
  allowedRoles?: Role[]
}

export function RoleMentionPicker({ projectId, query, onSelect, onCreateNew, allowedRoles }: RoleMentionPickerProps) {
  const { t } = useTranslation()
  const { data: allRoles, isLoading } = useRoles(projectId)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const roles = allowedRoles || allRoles

  const filteredRoles = useMemo(
    () => roles?.filter(role =>
      role.name.toLowerCase().includes(query.toLowerCase())
      || role.displayName.toLowerCase().includes(query.toLowerCase()),
    ) || [],
    [roles, query],
  )

  const items = useMemo<Array<Role | { id: 'create', name: string, displayName: string, type: 'external' }>>(() => [
    ...filteredRoles,
    { id: 'create', name: 'create-new', displayName: t('role.createNew', 'Create new role...'), type: 'external' },
  ], [filteredRoles, t])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[selectedIndex]
        if (item.id === 'create') {
          onCreateNew()
        } else {
          onSelect(item as Role)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onSelect(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, selectedIndex, onSelect, onCreateNew])

  if (isLoading) {
    return (
      <div className="p-2 text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="absolute bottom-full left-0 mb-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-auto">
      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
        {query ? `${t('common.search')} "${query}"` : t('role.selectRole', 'Select role')}
      </div>

      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-accent transition-colors ${
            index === selectedIndex ? 'bg-accent' : ''
          }`}
          onClick={() => {
            if (item.id === 'create') {
              onCreateNew()
            } else {
              onSelect(item as Role)
            }
          }}
        >
          <span className="text-lg">{item.id === 'create' ? '+' : ((item as Role).avatar || '🤖')}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{item.displayName}</div>
            {item.id !== 'create' && (
              <div className="text-xs text-muted-foreground">
                @
                {item.name}
                {' · '}
                {item.type === 'internal' ? t('role.internal', 'Internal') : t('role.external', 'External')}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

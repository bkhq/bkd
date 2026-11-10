import { describe, expect, it } from 'vitest'
import { groupSlashCommands } from '@/components/issue-detail/slash-command-groups'

describe('groupSlashCommands', () => {
  it('splits engine commands into skills, plugin commands, built-ins and plugins, in that order', () => {
    const groups = groupSlashCommands(
      ['compact', '/pma', 'legal:triage-nda', 'clear', 'bkd', 'pdf-viewer:open'],
      [{ name: 'legal' }],
      new Set(['pma', 'bkd']),
    )
    expect(groups).toEqual([
      { id: 'skills', items: [{ value: '/pma', category: 'command' }, { value: '/bkd', category: 'command' }] },
      { id: 'pluginCommands', items: [{ value: '/legal:triage-nda', category: 'command' }, { value: '/pdf-viewer:open', category: 'command' }] },
      { id: 'builtin', items: [{ value: '/compact', category: 'command' }, { value: '/clear', category: 'command' }] },
      { id: 'plugins', items: [{ value: '/legal', category: 'plugin' }] },
    ])
  })

  it('drops empty groups', () => {
    expect(groupSlashCommands(['compact'], [], new Set()).map(g => g.id)).toEqual(['builtin'])
  })
})

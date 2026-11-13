export interface TaggedCommand {
  value: string
  category: 'command' | 'plugin'
}

export type SlashCommandGroupId = 'skills' | 'pluginCommands' | 'builtin' | 'plugins'

export interface SlashCommandGroup {
  id: SlashCommandGroupId
  items: TaggedCommand[]
}

const ORDER: SlashCommandGroupId[] = ['skills', 'pluginCommands', 'builtin', 'plugins']

function slash(cmd: string): string {
  return cmd.startsWith('/') ? cmd : `/${cmd}`
}

/**
 * Groups the engine's slash commands for the menu: installed skills (by name),
 * plugin commands (`plugin:command`), the engine's own commands and bundled
 * skills, then the plugins it reported. Empty groups are dropped.
 */
export function groupSlashCommands(
  commands: string[],
  plugins: Array<{ name: string }>,
  skillNames: ReadonlySet<string>,
): SlashCommandGroup[] {
  const byId = new Map<SlashCommandGroupId, TaggedCommand[]>(ORDER.map(id => [id, []]))
  for (const cmd of commands) {
    const value = slash(cmd)
    const name = value.slice(1)
    const id = skillNames.has(name) ? 'skills' : name.includes(':') ? 'pluginCommands' : 'builtin'
    byId.get(id)!.push({ value, category: 'command' })
  }
  for (const p of plugins) byId.get('plugins')!.push({ value: slash(p.name), category: 'plugin' })
  return ORDER.map(id => ({ id, items: byId.get(id)! })).filter(g => g.items.length > 0)
}

/** cmdk value of a menu row; unique across groups because a command and a plugin can share a name. */
export function commandKey(group: SlashCommandGroupId, item: TaggedCommand): string {
  return `${group}:${item.value}`
}

/** The command text of a row's cmdk value (group ids contain no colon). */
export function commandFromKey(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

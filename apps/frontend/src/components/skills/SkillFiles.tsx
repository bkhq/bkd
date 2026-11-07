import type { SkillInfo } from '@bkd/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createFmClient } from '@/fm/client/client'
import { useMounts } from '@/fm/client/hooks'
import { markdownPlugin } from '@/fm/plugins/markdown'
import { FileManager } from '@/fm/react/file-manager'
import { enLabels, zhLabels } from '@/fm/react/labels'
import { skillsKeys } from '@/hooks/use-skills'

const plugins = [markdownPlugin()]

/**
 * The file manager over one skill (`/api/skills/fm/:projectId`, mount
 * `<location>~<name>`). A change reloads the skill list, whose names and
 * descriptions come from SKILL.md.
 */
export function SkillFiles({ skill, projectId }: { skill: SkillInfo, projectId?: string }) {
  const { i18n } = useTranslation()
  const queryClient = useQueryClient()
  const scope = projectId ?? 'global'
  const client = useMemo(() => createFmClient({
    baseUrl: `/api/skills/fm/${scope}`,
    fetch: async (input, init) => {
      const res = await fetch(input, init)
      if (res.ok && (init?.method ?? 'GET') !== 'GET') void queryClient.invalidateQueries({ queryKey: skillsKeys.all })
      return res
    },
  }), [scope, queryClient])
  const mount = `${skill.location}~${skill.name}`
  const mounts = useMounts(client)
  // The scope serves every skill: the sidebar keeps this one
  const hidden = useMemo(() => (mounts.data ?? []).map(m => m.id).filter(id => id !== mount), [mounts.data, mount])

  // The manager renders the error / empty states itself
  if (mounts.isPending) return null

  return (
    <FileManager
      key={`${scope}:${mount}`}
      client={client}
      labels={i18n.language.startsWith('zh') ? zhLabels : enLabels}
      initialMount={mount}
      readOnly={skill.managed}
      sidebar={{ hidden }}
      features={{ starred: false, recent: false }}
      plugins={plugins}
      storageKey="bkd-skills-fm"
      className="min-h-0 flex-1 rounded-none border-0"
    />
  )
}

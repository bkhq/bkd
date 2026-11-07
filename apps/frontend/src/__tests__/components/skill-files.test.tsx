import type { SkillInfo } from '@bkd/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillFiles } from '@/components/skills/SkillFiles'
import type { FmClient } from '@/fm/client/client'
import i18n from '@/i18n'

/** The fm `<FileManager />` over one skill (`/api/skills/fm/:projectId`). */

const mocks = vi.hoisted(() => ({
  client: undefined as FmClient | undefined,
  mounts: { isPending: false, data: [{ id: 'global-agents~notes' }, { id: 'global-agents~pma' }, { id: 'global-claude~other' }] } as { isPending: boolean, data?: Array<{ id: string }> },
}))

vi.mock('@/fm/client/hooks', async () => ({
  ...await vi.importActual<typeof import('@/fm/client/hooks')>('@/fm/client/hooks'),
  useMounts: () => mocks.mounts,
}))

vi.mock('@/fm/react/file-manager', () => ({
  FileManager: ({ client, initialMount, readOnly, plugins, sidebar }: { client: FmClient, initialMount: string, readOnly?: boolean, plugins: { id: string }[], sidebar?: { hidden?: string[], drives?: boolean } }) => {
    mocks.client = client
    return (
      <div data-plugins={plugins.map(p => p.id).join(',')} data-hidden={sidebar?.hidden?.join(',')} data-drives={String(sidebar?.drives ?? true)}>
        {`fm ${client.baseUrl} ${initialMount} ${readOnly ? 'read-only' : 'editable'}`}
      </div>
    )
  },
}))

const skill = (over: Partial<SkillInfo> = {}): SkillInfo => ({
  location: 'global-agents',
  scope: 'global',
  name: 'notes',
  description: '',
  path: '/home/u/.agents/skills/notes',
  managed: false,
  source: null,
  sourceUrl: null,
  updatedAt: null,
  sourcePath: null,
  sourceRef: null,
  agents: ['codex'],
  ...over,
})

function renderFiles(queryClient: QueryClient, props: { skill: SkillInfo, projectId?: string }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SkillFiles {...props} />
    </QueryClientProvider>,
  )
}

describe('skillFiles', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.mounts = { isPending: false, data: [{ id: 'global-agents~notes' }, { id: 'global-agents~pma' }, { id: 'global-claude~other' }] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"mounts":[]}', { status: 200, headers: { 'content-type': 'application/json' } })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the skill mount of the global scope, editable, with Markdown previews', () => {
    renderFiles(new QueryClient(), { skill: skill() })
    const fm = screen.getByText('fm /api/skills/fm/global global-agents~notes editable')
    expect(fm).toHaveAttribute('data-plugins', 'markdown')
  })

  it('shows only this skill in the sidebar tree, as its one drive', () => {
    renderFiles(new QueryClient(), { skill: skill() })
    const fm = screen.getByText('fm /api/skills/fm/global global-agents~notes editable')
    expect(fm).toHaveAttribute('data-drives', 'true')
    expect(fm).toHaveAttribute('data-hidden', 'global-agents~pma,global-claude~other')
  })

  it('renders nothing until the mounts are known', () => {
    mocks.mounts = { isPending: true }
    renderFiles(new QueryClient(), { skill: skill() })
    expect(screen.queryByText(/^fm /)).toBeNull()
  })

  it('opens an installed skill read-only, on the project scope when a project is picked', () => {
    renderFiles(new QueryClient(), { skill: skill({ name: 'pma', managed: true }), projectId: 'p1' })
    expect(screen.getByText('fm /api/skills/fm/p1 global-agents~pma read-only')).toBeInTheDocument()
  })

  it('reloads the skill list after a change, not after a read', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderFiles(queryClient, { skill: skill() })

    await mocks.client!.mounts()
    expect(invalidate).not.toHaveBeenCalled()

    await mocks.client!.mkdir('global-agents~notes', '/refs')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['skills'] })
  })
})

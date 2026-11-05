import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceFiles } from '@/components/files/WorkspaceFiles'
import i18n from '@/i18n'

/** The fm `<FileManager />` wired to a project (`/api/fm/:projectId`). */

const mocks = vi.hoisted(() => ({
  mounts: { isPending: false, data: [] as Array<{ id: string }> | undefined },
  onChangesSummary: undefined as (() => void) | undefined,
}))

vi.mock('@/fm/client/hooks', async () => ({
  ...await vi.importActual<typeof import('@/fm/client/hooks')>('@/fm/client/hooks'),
  useMounts: () => mocks.mounts,
}))
vi.mock('@/fm/react/file-manager', () => ({
  FileManager: ({ client, initialMount }: { client: { baseUrl: string }, initialMount: string }) => (
    <div>{`fm ${client.baseUrl} ${initialMount}`}</div>
  ),
}))
vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    onChangesSummary: (fn: () => void) => {
      mocks.onChangesSummary = fn
      return () => {}
    },
  },
}))

function renderFiles(queryClient: QueryClient, issueId?: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceFiles projectId="p1" issueId={issueId} />
    </QueryClientProvider>,
  )
}

describe('workspaceFiles', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.mounts = { isPending: false, data: [{ id: 'project' }, { id: 'wt-i1' }] }
  })

  it('opens on the issue worktree when the project serves one', () => {
    renderFiles(new QueryClient(), 'i1')
    expect(screen.getByText('fm /api/fm/p1 wt-i1')).toBeInTheDocument()
  })

  it('opens on the project directory for an issue without a worktree', () => {
    renderFiles(new QueryClient(), 'i2')
    expect(screen.getByText('fm /api/fm/p1 project')).toBeInTheDocument()
  })

  it('waits for the mounts before choosing one', () => {
    mocks.mounts = { isPending: true, data: undefined }
    renderFiles(new QueryClient(), 'i1')
    expect(screen.queryByText(/^fm /)).not.toBeInTheDocument()
  })

  it('refreshes the listings, not open files, when an issue\'s changes settle', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderFiles(queryClient)
    act(() => mocks.onChangesSummary?.())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fm', '/api/fm/p1', 'list'] })
  })
})

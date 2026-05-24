import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options
      if (options && typeof options === 'object') {
        return (options as Record<string, unknown>).defaultValue as string ?? key
      }
      return key
    },
    i18n: { language: 'en' },
  }),
}))

const createIssueMutate = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateIssue: () => ({ mutate: createIssueMutate, isPending: false }),
  useProject: () => ({ data: { id: 'p1', name: 'Alpha', isGitRepo: true } }),
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Alpha Project' },
      { id: 'p2', name: 'Beta Project' },
    ],
  }),
  useEngineAvailability: () => ({ data: { engines: [], models: {} } }),
  useEngineProfiles: () => ({ data: [] }),
  useEngineSettings: () => ({ data: { engines: {} } }),
  useOmitModel: () => ({ data: { enabled: false } }),
}))

vi.mock('@/components/cockpit/IssueTemplateSelect', () => ({
  IssueTemplateSelect: () => <div data-testid="template-select-stub" />,
}))

const closeMock = vi.fn()
let mockStoreState = {
  createDialogOpen: false,
  createDialogStatusId: undefined as string | undefined,
  createDialogProjectId: undefined as string | undefined,
  closeCreateDialog: closeMock,
}

vi.mock('@/stores/panel-store', () => ({
  usePanelStore: (selector?: (s: typeof mockStoreState) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState)
    return mockStoreState
  },
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('createIssueDialog — project selection (BUG-003 regression)', () => {
  beforeEach(() => {
    createIssueMutate.mockReset()
    closeMock.mockReset()
    mockStoreState = {
      createDialogOpen: false,
      createDialogStatusId: undefined,
      createDialogProjectId: undefined,
      closeCreateDialog: closeMock,
    }
  })

  it('shows project selector when no projectId is resolved', () => {
    mockStoreState.createDialogOpen = true
    render(
      <Wrapper>
        <CreateIssueDialog />
      </Wrapper>,
    )
    expect(screen.getByText('Select project')).toBeDefined()
    expect(screen.getByText('Alpha Project')).toBeDefined()
    expect(screen.getByText('Beta Project')).toBeDefined()
  })

  it('does NOT show project selector when projectId is resolved from store', () => {
    mockStoreState.createDialogOpen = true
    mockStoreState.createDialogProjectId = 'p1'
    render(
      <Wrapper>
        <CreateIssueDialog />
      </Wrapper>,
    )
    expect(screen.queryByText('Select project')).toBeNull()
  })

  it('create button is disabled when no project is selected', () => {
    mockStoreState.createDialogOpen = true
    render(
      <Wrapper>
        <CreateIssueDialog />
      </Wrapper>,
    )
    const btn = screen.getByText('createIssue.create') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('create button is enabled after selecting a project and entering title', () => {
    mockStoreState.createDialogOpen = true
    render(
      <Wrapper>
        <CreateIssueDialog />
      </Wrapper>,
    )
    // Select a project
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } })
    // Enter title
    const textarea = screen.getByPlaceholderText('issue.describeWork') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'New task' } })

    const btn = screen.getByText('createIssue.create') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })
})

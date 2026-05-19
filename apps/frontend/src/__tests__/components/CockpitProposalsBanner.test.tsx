import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CockpitProposalsBanner } from '@/components/cockpit/CockpitProposalsBanner'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const listMock = vi.fn()
const approveMutate = vi.fn()
const rejectMutate = vi.fn()

vi.mock('@/hooks/use-cockpit-proposals', () => ({
  useCockpitProposals: () => ({ data: listMock(), isLoading: false }),
  useApproveCockpitProposal: () => ({ mutate: approveMutate, isPending: false }),
  useRejectCockpitProposal: () => ({ mutate: rejectMutate, isPending: false }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('cockpitProposalsBanner', () => {
  beforeEach(() => {
    listMock.mockReset()
    approveMutate.mockReset()
    rejectMutate.mockReset()
  })

  it('renders nothing when there are no pending proposals', () => {
    listMock.mockReturnValue([])
    const { container } = render(<Wrapper><CockpitProposalsBanner /></Wrapper>)
    expect(container.firstChild).toBeNull()
  })

  it('renders each pending proposal with summary + approve + reject buttons', () => {
    listMock.mockReturnValue([
      { id: 'p1', type: 'cancel_issue', summary: 'Cancel #123 (stuck 2h)', params: {}, status: 'pending', createdAt: Date.now() },
      { id: 'p2', type: 'create_issue', summary: 'Create follow-up task', params: {}, status: 'pending', createdAt: Date.now() },
    ])
    render(<Wrapper><CockpitProposalsBanner /></Wrapper>)
    expect(screen.getByText('Cancel #123 (stuck 2h)')).toBeDefined()
    expect(screen.getByText('Create follow-up task')).toBeDefined()
    expect(screen.getAllByTestId(/^cockpit-proposal-approve-/).length).toBe(2)
    expect(screen.getAllByTestId(/^cockpit-proposal-reject-/).length).toBe(2)
  })

  it('approve button triggers the mutation with the right id', () => {
    listMock.mockReturnValue([
      { id: 'pX', type: 'cancel_issue', summary: 'Cancel X', params: {}, status: 'pending', createdAt: Date.now() },
    ])
    render(<Wrapper><CockpitProposalsBanner /></Wrapper>)
    fireEvent.click(screen.getByTestId('cockpit-proposal-approve-pX'))
    expect(approveMutate).toHaveBeenCalledWith('pX')
  })

  it('reject button triggers the mutation with the right id', () => {
    listMock.mockReturnValue([
      { id: 'pY', type: 'cancel_issue', summary: 'Cancel Y', params: {}, status: 'pending', createdAt: Date.now() },
    ])
    render(<Wrapper><CockpitProposalsBanner /></Wrapper>)
    fireEvent.click(screen.getByTestId('cockpit-proposal-reject-pY'))
    expect(rejectMutate).toHaveBeenCalledWith('pY')
  })
})

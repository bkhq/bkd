import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import HomePage from '@/pages/HomePage'

/** Dashboard tag filter (20260912-1920-project-tags). */

const projects = [
  { id: 'p1', name: 'Alpha', sortOrder: 'a0', tags: ['work'] },
  { id: 'p2', name: 'Beta', sortOrder: 'a1', tags: ['side', 'rust'] },
  { id: 'p3', name: 'Gamma', sortOrder: 'a2' },
]

vi.mock('@/hooks/use-kanban', () => ({
  useProjects: () => ({ data: projects, isLoading: false }),
  useArchivedProjects: () => ({ data: [] }),
  useSortProject: () => ({ mutate: vi.fn() }),
  useUnarchiveProject: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/use-project-stats', () => ({
  useProjectStats: () => ({ issueCount: 0 }),
}))

vi.mock('@/components/ProjectSettingsDialog', () => ({ ProjectSettingsDialog: () => null }))
vi.mock('@/components/CreateProjectDialog', () => ({ CreateProjectDialog: () => null }))
vi.mock('@/components/AppSettingsDialog', () => ({ AppSettingsDialog: () => null }))

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('home page tag filter', () => {
  it('lists every tag used by a project, deduplicated and sorted', () => {
    renderHome()
    const chips = ['rust', 'side', 'work'].map(tag => screen.getByRole('button', { name: tag }))
    expect(chips.map(c => c.textContent)).toEqual(['rust', 'side', 'work'])
  })

  it('narrows the grid to the selected tag and restores it via All', async () => {
    renderHome()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'work' }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('project.filterAllTags') }))
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('clicking the active chip clears the filter', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'rust' }))
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'rust' }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})

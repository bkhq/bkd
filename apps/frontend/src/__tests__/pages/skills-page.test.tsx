import type { SkillInfo } from '@bkd/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import SkillsPage from '@/pages/SkillsPage'

const skill = (over: Partial<SkillInfo>): SkillInfo => ({
  location: 'global-agents',
  scope: 'global',
  name: 'x',
  description: '',
  path: '/home/u/.agents/skills/x',
  managed: false,
  source: null,
  sourceUrl: null,
  updatedAt: null,
  agents: ['claude-code', 'codex'],
  ...over,
})

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  create: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  skills: [] as SkillInfo[],
}))

vi.mock('@/components/kanban/AppSidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/kanban/MobileSidebar', () => ({ MobileSidebar: () => null }))
vi.mock('@/components/files/CodeEditor', () => ({
  CodeEditor: ({ value, onChange, readOnly }: { value: string, onChange: (v: string) => void, readOnly?: boolean }) => (
    <textarea aria-label="editor" value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} />
  ),
}))
vi.mock('@/hooks/use-kanban', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Proj', directory: '/w/proj' }] }),
}))
vi.mock('@/hooks/use-skills', () => ({
  useSkills: () => ({ data: { skills: mocks.skills }, isLoading: false }),
  useSkillFiles: () => ({ data: [{ path: 'SKILL.md', type: 'file', size: 10 }] }),
  useSkillFile: () => ({ data: { path: 'SKILL.md', content: '---\nname: x\n---\nbody', binary: false } }),
  useSaveSkillFile: () => ({ mutate: mocks.save, isPending: false }),
  useCreateSkill: () => ({ mutate: mocks.create, isPending: false, error: null, reset: vi.fn() }),
  useCopySkill: () => ({ mutate: mocks.copy, isPending: false, error: null, reset: vi.fn() }),
  useDeleteSkill: () => ({ mutate: mocks.remove, isPending: false }),
}))
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))

function renderPage() {
  return render(
    <MemoryRouter>
      <SkillsPage />
    </MemoryRouter>,
  )
}

describe('skills page', () => {
  beforeEach(async () => {
    Object.values(mocks).forEach(m => typeof m === 'function' && m.mockReset())
    mocks.skills = [
      skill({ name: 'pma', description: 'Project management', managed: true, source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git' }),
      skill({ name: 'local-notes', description: 'My notes' }),
      skill({ name: 'claude-only', location: 'global-claude', agents: ['claude-code'] }),
    ]
    await i18n.changeLanguage('en')
  })

  it('lists skills with their source and agents', () => {
    renderPage()
    const pma = screen.getByRole('button', { name: /pma/ })
    expect(within(pma).getByText('zzci/skills')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /local-notes/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /claude-only/ })).toBeInTheDocument()
  })

  it('opens an installed skill read-only and offers a local copy', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    expect(screen.getByLabelText('editor')).toHaveAttribute('readonly')
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Copy to local skill' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pma-mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(mocks.copy).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'global-agents', name: 'pma', newName: 'pma-mine' }),
      expect.anything(),
    )
  })

  it('edits and saves a local skill file', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'global-agents', name: 'local-notes', path: 'SKILL.md', content: 'changed' }),
      expect.anything(),
    )
  })

  it('creates a skill', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'fresh' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Does a thing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.create).toHaveBeenCalledWith(
      { scope: 'global', name: 'fresh', description: 'Does a thing' },
      expect.anything(),
    )
  })

  it('confirms before moving a local skill to the trash', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'global-agents', name: 'local-notes' }),
      expect.anything(),
    )
  })
})

describe('skills page source link', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('links only http(s) sources; anything else from the lock file stays plain text', () => {
    mocks.skills = [
      skill({ name: 'good', managed: true, source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git' }),
      skill({ name: 'evil', managed: true, source: 'evil/src', sourceUrl: 'javascript:alert(1)' }),
    ]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /good/ }))
    expect(screen.getByRole('link', { name: 'zzci/skills' })).toHaveAttribute('href', 'https://github.com/zzci/skills')
    fireEvent.click(screen.getByRole('button', { name: /evil/ }))
    expect(screen.queryByRole('link', { name: 'evil/src' })).toBeNull()
    expect(screen.getAllByText('evil/src').length).toBeGreaterThan(0)
  })
})

import type { SkillInfo } from '@bkd/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  sourcePath: null,
  sourceRef: null,
  agents: ['claude-code', 'codex'],
  ...over,
})

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  create: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  removeError: null as Error | null,
  skills: [] as SkillInfo[],
  files: [{ path: 'SKILL.md', type: 'file', size: 10 }] as { path: string, type: string, size: number }[],
  cliAvailable: true,
  start: vi.fn(),
  operations: {} as Record<string, unknown>,
  updates: [] as { location: string, name: string, status: string }[],
  upload: vi.fn(),
  check: vi.fn(),
  isMobile: false,
}))

vi.mock('@/components/kanban/AppSidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/kanban/MobileSidebar', () => ({ MobileSidebar: () => null }))
vi.mock('@/components/files/CodeEditor', () => ({
  CodeEditor: ({ value, onChange, readOnly }: { value: string, onChange: (v: string) => void, readOnly?: boolean }) => (
    <textarea aria-label="editor" value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/files/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md-preview">{content}</div>,
}))
vi.mock('@/hooks/use-kanban', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Proj', directory: '/w/proj' }, { id: 'p2', name: 'Other', directory: '/w/other' }] }),
}))
vi.mock('@/hooks/use-skills', () => ({
  useSkills: () => ({ data: { skills: mocks.skills, cliAvailable: mocks.cliAvailable }, isLoading: false }),
  useStartSkillsOperation: () => ({ mutate: mocks.start, isPending: false, error: null, reset: vi.fn() }),
  useSkillsOperation: (id?: string) => ({ data: id ? mocks.operations[id] : undefined }),
  useCancelSkillsOperation: () => ({ mutate: vi.fn() }),
  useCheckSkillUpdates: () => ({ mutate: mocks.check, isPending: false }),
  useUploadSkills: () => ({ mutate: mocks.upload, isPending: false, error: null, reset: vi.fn(), data: undefined }),
  useSkillFiles: () => ({ data: mocks.files }),
  useSkillFile: () => ({ data: { path: 'SKILL.md', content: '---\nname: x\n---\nbody', binary: false } }),
  useSaveSkillFile: () => ({ mutate: mocks.save, isPending: false }),
  useCreateSkill: () => ({ mutate: mocks.create, isPending: false, error: null, reset: vi.fn() }),
  useCopySkill: () => ({ mutate: mocks.copy, isPending: false, error: null, reset: vi.fn() }),
  useDeleteSkill: () => ({ mutate: mocks.remove, isPending: false, error: mocks.removeError, reset: vi.fn() }),
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }))
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))

afterEach(() => {
  mocks.isMobile = false
})

/** The select only commits on a full pointer sequence, not a bare click. */
async function pickProject(name: string) {
  fireEvent.click(screen.getByLabelText('Project skills'))
  const listbox = await screen.findByRole('listbox')
  const option = within(listbox).getByText(name).closest('[role="option"]')!
  fireEvent.pointerDown(option)
  fireEvent.mouseDown(option)
  fireEvent.pointerUp(option)
  fireEvent.mouseUp(option)
  fireEvent.click(option)
}

/** A check answers with the statuses in `mocks.updates` for the skill asked about. */
function answerChecks() {
  mocks.check.mockImplementation((q: { name?: string }, opts: { onSuccess: (d: { updates: typeof mocks.updates }) => void }) =>
    opts.onSuccess({ updates: mocks.updates.filter(u => !q.name || u.name === q.name) }))
}

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
    mocks.cliAvailable = true
    mocks.removeError = null
    mocks.operations = {}
    mocks.updates = []
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

  it('opens an installed skill read-only and offers a local copy', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    expect(await screen.findByLabelText('editor')).toHaveAttribute('readonly')
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'x' } })
    expect(screen.queryByRole('button', { name: 'Save file' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Copy to local skill' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pma-mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(mocks.copy).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'global-agents', name: 'pma', newName: 'pma-mine' }),
      expect.anything(),
    )
  })

  it('edits and saves a local skill file, like the workspace editor', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    // Save only appears once there is something to save
    expect(screen.queryByRole('button', { name: 'Save file' })).toBeNull()
    fireEvent.change(await screen.findByLabelText('editor'), { target: { value: 'changed' } })
    expect(screen.getByText('Modified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'global-agents', name: 'local-notes', path: 'SKILL.md', content: 'changed' }),
      expect.anything(),
    )
  })

  it('shows either the list or the open skill on a small screen', async () => {
    mocks.isMobile = true
    renderPage()
    expect(screen.queryByText('Select a skill to view its files')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    expect(await screen.findByLabelText('editor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /claude-only/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('button', { name: /claude-only/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('editor')).toBeNull()
  })

  it('shows the list and the open skill side by side on a large screen', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    expect(screen.getByRole('button', { name: /claude-only/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to list' })).toBeNull()
  })

  it('does not carry an unsaved edit into the same-named skill of another project', async () => {
    mocks.skills = [skill({ name: 'deploy', location: 'project-agents', scope: 'project' })]
    renderPage()
    await pickProject('Proj')
    fireEvent.click(screen.getByRole('button', { name: /deploy/ }))
    fireEvent.change(await screen.findByLabelText('editor'), { target: { value: 'draft for Proj' } })
    expect(screen.getByText('Modified')).toBeInTheDocument()

    await pickProject('Other')
    expect(screen.getByLabelText('editor')).not.toHaveValue('draft for Proj')
    expect(screen.queryByText('Modified')).toBeNull()
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
  it('shows why deleting a skill failed instead of closing silently', () => {
    mocks.removeError = new Error('Skill not found')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(within(screen.getByRole('alertdialog')).getByText('Skill not found')).toBeInTheDocument()
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

describe('skills page groups', () => {
  beforeEach(async () => {
    mocks.skills = [skill({ name: 'local-notes' })]
    await i18n.changeLanguage('en')
  })

  it('collapses and expands a scope group from its header', () => {
    renderPage()
    const header = screen.getByRole('button', { name: /Global/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /local-notes/ })).toBeNull()
    fireEvent.click(header)
    expect(screen.getByRole('button', { name: /local-notes/ })).toBeInTheDocument()
  })
})

describe('skills page file tree', () => {
  beforeEach(async () => {
    mocks.skills = [skill({ name: 'local-notes' })]
    mocks.files = [
      { path: 'SKILL.md', type: 'file', size: 10 },
      { path: 'references', type: 'dir', size: 0 },
      { path: 'references/api.md', type: 'file', size: 5 },
      { path: 'references/guide.md', type: 'file', size: 5 },
    ]
    await i18n.changeLanguage('en')
  })

  it('shows files as a folder tree that collapses', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    const tree = screen.getByRole('navigation', { name: 'Files' })
    const folder = within(tree).getByRole('button', { name: 'references' })
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    // Rows show the file name, not the whole path
    expect(within(tree).getByRole('button', { name: 'api.md' })).toBeInTheDocument()
    fireEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    expect(within(tree).queryByRole('button', { name: 'api.md' })).toBeNull()
    expect(within(tree).getByRole('button', { name: 'SKILL.md' })).toBeInTheDocument()
  })

  it('hides and shows the tree beside the file on a large screen', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'File tree' }))
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull()
    expect(await screen.findByLabelText('editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'File tree' }))
    expect(screen.getByRole('navigation', { name: 'Files' })).toBeInTheDocument()
  })

  it('takes turns with the file at full width on a small screen, as in the workspace', async () => {
    mocks.isMobile = true
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    // SKILL.md opens first, so the file is shown and the tree is closed
    const editor = await screen.findByLabelText('editor')
    expect(editor.closest('.hidden')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull()

    // The file stays mounted (keeping its undo history) but is hidden behind the tree
    fireEvent.click(screen.getByRole('button', { name: 'File tree' }))
    const tree = screen.getByRole('navigation', { name: 'Files' })
    expect(screen.getByLabelText('editor').closest('.hidden')).not.toBeNull()

    // Picking a file closes the tree again
    fireEvent.click(within(tree).getByRole('button', { name: 'api.md' }))
    expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull()
    expect(screen.getByLabelText('editor').closest('.hidden')).toBeNull()
  })
})

describe('skills page Markdown preview', () => {
  beforeEach(async () => {
    mocks.skills = [skill({ name: 'local-notes' })]
    mocks.files = [{ path: 'SKILL.md', type: 'file', size: 10 }]
    await i18n.changeLanguage('en')
  })

  it('switches a Markdown file between source and rendered preview, as in the workspace', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    expect(await screen.findByLabelText('editor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByTestId('md-preview')).toHaveTextContent('body')
    expect(screen.queryByLabelText('editor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(await screen.findByLabelText('editor')).toBeInTheDocument()
  })
})

describe('skills page CLI operations', () => {
  const op = (id: string, over: Record<string, unknown>) => ({ id, op: 'preview', scope: 'global', status: 'running', output: [], error: null, result: null, startedAt: '', finishedAt: null, ...over })

  beforeEach(async () => {
    mocks.start.mockReset()
    mocks.cliAvailable = true
    mocks.operations = {}
    mocks.updates = []
    mocks.skills = [skill({ name: 'pma', managed: true, source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git' })]
    mocks.updates = [{ location: 'global-agents', name: 'pma', status: 'update' }]
    await i18n.changeLanguage('en')
  })

  it('closes the uninstall dialog for good once the uninstall succeeds', () => {
    mocks.skills = [
      skill({ name: 'pma', managed: true, source: 'zzci/skills' }),
      skill({ name: 'other', managed: true, source: 'zzci/skills' }),
    ]
    mocks.start.mockImplementation((_input, opts) => opts.onSuccess({ id: 'u1' }))
    const { rerender } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Uninstall' }))

    mocks.operations.u1 = op('u1', { op: 'remove', status: 'succeeded' })
    mocks.skills = [skill({ name: 'other', managed: true, source: 'zzci/skills' })]
    rerender(<MemoryRouter><SkillsPage /></MemoryRouter>)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // Selecting another skill must not bring the dialog back
    fireEvent.click(screen.getByRole('button', { name: /other/ }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('previews a repository, then installs the chosen skills', () => {
    mocks.start.mockImplementation((input: { op: string }, opts: { onSuccess: (o: { id: string }) => void }) => opts.onSuccess({ id: input.op === 'preview' ? 'p1' : 'a1' }))
    const { rerender } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    // A side sheet, not a centered dialog
    expect(screen.getByRole('dialog')).toHaveAttribute('data-slot', 'sheet-content')
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'zzci/skills' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(mocks.start).toHaveBeenLastCalledWith({ op: 'preview', source: 'zzci/skills', scope: 'global' }, expect.anything())

    mocks.operations.p1 = op('p1', { status: 'succeeded', result: { skills: [{ name: 'alpha', description: 'First' }, { name: 'beta', description: 'Second' }] } })
    rerender(<MemoryRouter><SkillsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('checkbox', { name: /alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(mocks.start).toHaveBeenLastCalledWith(
      { op: 'add', source: 'zzci/skills', skills: ['alpha'], agents: ['claude-code', 'codex'], scope: 'global' },
      expect.anything(),
    )
  })

  it('starts the install sheet afresh after its Close button closed it', () => {
    mocks.start.mockImplementation((_input: unknown, opts: { onSuccess: (o: { id: string }) => void }) => opts.onSuccess({ id: 'p1' }))
    mocks.operations.p1 = op('p1', { status: 'succeeded', result: { skills: [{ name: 'alpha', description: 'First' }] } })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'zzci/skills' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('checkbox', { name: /alpha/ })).toBeInTheDocument()
    const footerClose = within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' }).find(b => b.textContent === 'Close')!
    fireEvent.click(footerClose)
    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    expect(screen.getByLabelText('Repository')).toHaveValue('')
    expect(screen.queryByRole('checkbox', { name: /alpha/ })).toBeNull()
  })

  it('keeps a running operation reachable: the install sheet stays open until it ends', () => {
    // Closing it would drop the operation id while the server still runs it
    mocks.start.mockImplementation((_input: unknown, opts: { onSuccess: (o: { id: string }) => void }) => opts.onSuccess({ id: 'p1' }))
    mocks.operations.p1 = op('p1', { status: 'running' })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Install skill' }))
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'zzci/skills' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.keyDown(sheet, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('keeps the update dialog open while the update runs', () => {
    mocks.start.mockImplementation((_input: unknown, opts: { onSuccess: (o: { id: string }) => void }) => opts.onSuccess({ id: 'u1' }))
    mocks.operations.u1 = op('u1', { op: 'update', status: 'running' })
    answerChecks()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update selected (1)' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the uninstall dialog open while the uninstall runs', () => {
    mocks.start.mockImplementation((_input: unknown, opts: { onSuccess: (o: { id: string }) => void }) => opts.onSuccess({ id: 'r1' }))
    mocks.operations.r1 = op('r1', { op: 'remove', status: 'running' })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Uninstall' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('shows the CLI output of a running operation', () => {
    mocks.start.mockImplementation((_input: unknown, opts: { onSuccess: (o: { id: string }) => void }) => opts.onSuccess({ id: 'u1' }))
    mocks.operations.u1 = op('u1', { op: 'update', output: ['Updating pma…'] })
    answerChecks()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update selected (1)' }))
    expect(mocks.start).toHaveBeenCalledWith({ op: 'update', names: ['pma'], scope: 'global' }, expect.anything())
    expect(screen.getByText('Updating pma…')).toBeInTheDocument()
  })

  it('confirms before uninstalling an installed skill through the CLI', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/lock file/)).toBeInTheDocument()
    expect(within(dialog).getByText(/not removed automatically/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }))
    expect(mocks.start).toHaveBeenCalledWith({ op: 'remove', names: ['pma'], scope: 'global' }, expect.anything())
  })

  it('disables install and update when the CLI cannot run on the server', () => {
    mocks.cliAvailable = false
    renderPage()
    expect(screen.getByRole('button', { name: 'Install skill' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Update all/ })).toBeDisabled()
  })

  it('explains what deleting a local skill does and does not clean up', () => {
    mocks.skills = [skill({ name: 'local-notes' })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /local-notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/trash/)).toBeInTheDocument()
    // There is no restore action in the UI; the copy must not promise one.
    expect(within(dialog).getByText(/cannot be restored from this page/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/You can restore it from the trash/)).toBeNull()
    expect(within(dialog).getByText(/not removed automatically/)).toBeInTheDocument()
  })
})

describe('skills page update checks', () => {
  beforeEach(async () => {
    mocks.start.mockReset()
    mocks.check.mockReset()
    mocks.cliAvailable = true
    mocks.skills = [
      skill({ name: 'fresh', managed: true, source: 'a/repo' }),
      skill({ name: 'stale', managed: true, source: 'a/repo' }),
      skill({ name: 'gone', managed: true, source: 'a/repo' }),
      skill({ name: 'mine' }),
    ]
    mocks.updates = [
      { location: 'global-agents', name: 'fresh', status: 'latest' },
      { location: 'global-agents', name: 'stale', status: 'update' },
      { location: 'global-agents', name: 'gone', status: 'removed' },
    ]
    answerChecks()
    await i18n.changeLanguage('en')
  })

  it('checks nothing until asked', () => {
    renderPage()
    expect(mocks.check).not.toHaveBeenCalled()
    expect(screen.queryByText('Update available')).toBeNull()
    expect(screen.getByRole('button', { name: 'Update all' })).toBeEnabled()
  })

  it('checks one installed skill on request and offers Update only when there is one', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^fresh/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(mocks.check).toHaveBeenLastCalledWith({ location: 'global-agents', name: 'fresh' }, expect.anything())
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^stale/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(within(screen.getByRole('button', { name: /^stale/ })).getByText('Update available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
  })

  it('offers no check for a local skill', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^mine/ }))
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
  })

  it('confirms which skills to update before running the CLI', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^stale/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(mocks.start).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    // The skill with a known update comes pre-selected; the others do not
    expect(within(dialog).getByRole('checkbox', { name: /stale/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /fresh/ })).not.toBeChecked()
    expect(within(dialog).queryByRole('checkbox', { name: /mine/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update selected (1)' }))
    expect(mocks.start).toHaveBeenCalledWith({ op: 'update', names: ['stale'], scope: 'global' }, expect.anything())
  })

  it('lets Update all pick from every installed global skill, nothing pre-selected without a check', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Update all' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('checkbox').map(c => (c as HTMLInputElement).checked)).toEqual([false, false, false])
    expect(within(dialog).getByRole('button', { name: 'Update selected (0)' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /fresh/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /gone/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update selected (2)' }))
    expect(mocks.start).toHaveBeenCalledWith({ op: 'update', names: ['fresh', 'gone'], scope: 'global' }, expect.anything())
  })

  it('starts each opening of the update dialog from its pre-selection, not from a cancelled pick', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Update all' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /fresh/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update all' }))
    expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /fresh/ })).not.toBeChecked()
  })

  it('offers Update directly for a project skill, which cannot be checked, after confirming', async () => {
    mocks.skills = [skill({ name: 'deploy', location: 'project-agents', scope: 'project', managed: true, source: 'a/repo' })]
    renderPage()
    await pickProject('Proj')
    fireEvent.click(screen.getByRole('button', { name: /deploy/ }))
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('checkbox', { name: /deploy/ })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update selected (1)' }))
    expect(mocks.start).toHaveBeenCalledWith({ op: 'update', names: ['deploy'], scope: 'project', projectId: 'p1' }, expect.anything())
  })
})

describe('skills page upload', () => {
  beforeEach(async () => {
    mocks.upload.mockReset()
    mocks.skills = []
    await i18n.changeLanguage('en')
  })

  it('uploads a dropped file to the global scope', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Upload skill' }))
    const file = new File(['---\nname: x\n---'], 'x.md', { type: 'text/markdown' })
    fireEvent.drop(screen.getByTestId('skill-dropzone'), { dataTransfer: { files: [file] } })
    expect(mocks.upload).toHaveBeenCalledWith({ file, scope: 'global' }, expect.anything())
  })

  it('refuses files that are not .zip, .skill or .md', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Upload skill' }))
    fireEvent.drop(screen.getByTestId('skill-dropzone'), { dataTransfer: { files: [new File(['x'], 'notes.txt')] } })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(screen.getAllByText(/\.zip, \.skill or \.md/).length).toBeGreaterThan(0)
  })
})

describe('skills page source link button', () => {
  beforeEach(async () => {
    mocks.updates = []
    await i18n.changeLanguage('en')
  })

  it('opens the skill folder in its GitHub repository', () => {
    mocks.skills = [skill({ name: 'pma', managed: true, source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git', sourcePath: 'skills/pma' })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    const link = screen.getByRole('link', { name: 'Open on GitHub' })
    expect(link).toHaveAttribute('href', 'https://github.com/zzci/skills/tree/HEAD/skills/pma')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('opens the folder at the branch or tag the skill was installed from', () => {
    mocks.skills = [skill({ name: 'pma', managed: true, source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git', sourcePath: 'skills/pma', sourceRef: 'release/v1' })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /pma/ }))
    expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', 'https://github.com/zzci/skills/tree/release%2Fv1/skills/pma')
  })

  it('links the repository root for a skill at the root of its repo, and nothing for local or non-GitHub skills', () => {
    mocks.skills = [
      skill({ name: 'rooted', managed: true, source: 'a/b', sourceUrl: 'https://github.com/a/b.git', sourcePath: '' }),
      skill({ name: 'mine' }),
      skill({ name: 'odd', managed: true, source: 'x/y', sourceUrl: 'javascript:alert(1)', sourcePath: 'p' }),
    ]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /rooted/ }))
    expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', 'https://github.com/a/b')
    fireEvent.click(screen.getByRole('button', { name: /mine/ }))
    expect(screen.queryByRole('link', { name: 'Open on GitHub' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /odd/ }))
    expect(screen.queryByRole('link', { name: 'Open on GitHub' })).toBeNull()
  })
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from '@/components/issue-detail/ChatInput'

/** Slash-command menu opened by typing "/" in the chat input. */

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-changes-summary', () => ({ useChangesSummary: () => null }))
const skills = vi.hoisted(() => ({ names: [] as string[] }))
vi.mock('@/hooks/use-skills', () => ({ useSkills: () => ({ data: { skills: skills.names.map(name => ({ name })) } }) }))
vi.mock('@/hooks/use-kanban', () => ({
  useFollowUpIssue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearIssueSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutate: vi.fn() }),
  useEngineAvailability: () => ({ data: undefined }),
  useEngineSettings: () => ({ data: undefined }),
  useEngineProfiles: () => ({ data: [] }),
  useVirtualEngines: () => ({ data: [] }),
}))

const scrollIntoView = vi.fn()

// cmdk observes its list size; jsdom has no ResizeObserver
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})

afterEach(() => {
  cleanup()
  skills.names = []
  vi.unstubAllGlobals()
  scrollIntoView.mockClear()
})

function renderInput(pluginCommands: Array<{ name: string, path: string }> = []) {
  render(<ChatInput projectId="p1" issueId="i1" engineType="claude-code" slashCommands={['alpha', 'beta', 'gamma']} pluginCommands={pluginCommands} />)
  return screen.getByRole('textbox')
}

function typeSlash(textbox: HTMLElement) {
  fireEvent.change(textbox, { target: { value: '/' } })
}

const selected = () => screen.getAllByRole('option').find(o => o.getAttribute('aria-selected') === 'true')

describe('chatInput slash commands', () => {
  it('floats the menu above the input instead of growing the input card', () => {
    typeSlash(renderInput())
    const menu = screen.getByRole('listbox').closest('[data-slot="command-menu"]')!
    expect(menu).toHaveClass('absolute', 'bottom-full')
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['/alpha', '/beta', '/gamma'])
  })

  it('groups installed skills, plugin commands, built-ins and plugins under headings', () => {
    skills.names = ['gamma']
    render(<ChatInput projectId="p1" issueId="i1" engineType="claude-code" slashCommands={['compact', 'gamma', 'legal:brief']} pluginCommands={[{ name: 'legal', path: '/p' }]} />)
    typeSlash(screen.getByRole('textbox'))
    const groups = screen.getAllByRole('group').map(g => ({
      heading: document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent,
      items: [...g.querySelectorAll('[role="option"]')].map(o => o.textContent),
    }))
    expect(groups).toEqual([
      { heading: 'chat.commandGroups.skills', items: ['/gamma'] },
      { heading: 'chat.commandGroups.pluginCommands', items: ['/legal:brief'] },
      { heading: 'chat.commandGroups.builtin', items: ['/compact'] },
      { heading: 'chat.commandGroups.plugins', items: ['/legal'] },
    ])
    // Keyboard order follows the groups
    expect(selected()).toHaveTextContent('/gamma')
  })

  it('highlights one row when a command and a plugin share a name', () => {
    render(<ChatInput projectId="p1" issueId="i1" engineType="claude-code" slashCommands={['code-review', 'compact']} pluginCommands={[{ name: 'code-review', path: '/p' }]} />)
    const textbox = screen.getByRole('textbox')
    typeSlash(textbox)
    const isSelected = () => screen.getAllByRole('option').filter(o => o.getAttribute('aria-selected') === 'true')
    expect(isSelected()).toHaveLength(1)
    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    expect(isSelected()).toHaveLength(1)
    expect(isSelected()[0]).toHaveTextContent('/code-review')
    fireEvent.keyDown(textbox, { key: 'Enter' })
    expect(textbox).toHaveValue('/code-review ')
  })

  it('searches the toolbar picker by command text, not by the group in each row value', async () => {
    renderInput()
    fireEvent.click(screen.getByTitle('chat.commands'))
    const search = await screen.findByPlaceholderText('chat.commandSearch')
    fireEvent.change(search, { target: { value: 'builtin' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    fireEvent.change(search, { target: { value: 'gam' } })
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['/gamma'])
  })

  it('moves the selection with the arrow keys and scrolls it into view', () => {
    const textbox = renderInput()
    typeSlash(textbox)
    expect(selected()).toHaveTextContent('/alpha')
    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    expect(selected()).toHaveTextContent('/beta')
    expect(scrollIntoView).toHaveBeenCalled()
    fireEvent.keyDown(textbox, { key: 'ArrowUp' })
    fireEvent.keyDown(textbox, { key: 'ArrowUp' })
    expect(selected()).toHaveTextContent('/gamma')
  })

  it('inserts the selected command on Enter and on Tab', () => {
    const textbox = renderInput()
    typeSlash(textbox)
    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    fireEvent.keyDown(textbox, { key: 'Enter' })
    expect(textbox).toHaveValue('/beta ')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.change(textbox, { target: { value: '/ga' } })
    fireEvent.keyDown(textbox, { key: 'Tab' })
    expect(textbox).toHaveValue('/gamma ')
  })

  it('inserts a clicked command', () => {
    const textbox = renderInput()
    typeSlash(textbox)
    fireEvent.click(screen.getByRole('option', { name: '/gamma' }))
    expect(textbox).toHaveValue('/gamma ')
  })

  it('leaves the arrow, Home, End and Enter keys to the textarea while the menu is closed', () => {
    const textbox = renderInput()
    fireEvent.change(textbox, { target: { value: 'line one\nline two' } })
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter']) {
      // fireEvent returns false when a handler called preventDefault
      expect(fireEvent.keyDown(textbox, { key })).toBe(true)
    }
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotesDrawer } from '@/components/notes/NotesDrawer'
import i18n from '@/i18n'
import { useNotesStore } from '@/stores/notes-store'

const notes = vi.hoisted(() => ({ data: [] as unknown[] }))

vi.mock('@/hooks/use-notes', () => ({
  useNotes: () => ({ data: notes.data, isLoading: false, isError: false }),
  useCreateNote: () => ({ mutate: vi.fn() }),
  useUpdateNote: () => ({ mutate: vi.fn() }),
  useDeleteNote: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

describe('notes drawer', () => {
  beforeEach(async () => {
    notes.data = []
    await i18n.changeLanguage('en')
    useNotesStore.setState({ isOpen: true, listWidth: 240 })
  })

  it('lets the note list be resized', () => {
    render(<NotesDrawer />)
    const handle = screen.getByRole('separator', { name: 'Resize note list' })
    expect(handle).toHaveAttribute('aria-valuenow', '240')
    expect(handle.parentElement).toHaveStyle({ width: '240px' })
  })

  it('scrolls the note list in the ScrollArea base component', () => {
    render(<NotesDrawer />)
    expect(screen.getByText('No notes yet').closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
  })

  it('scrolls the note body in the ScrollArea, not in the textarea', () => {
    notes.data = [{ id: 'n1', title: 'Long', content: 'line\n'.repeat(200), isPinned: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }]
    useNotesStore.setState({ selectedNoteId: 'n1' })
    render(<NotesDrawer />)
    const body = screen.getByPlaceholderText('Write something...')
    expect(body.closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
    expect(body).toHaveClass('overflow-hidden')
  })

  it('keeps the scroll position when the note body is measured again', () => {
    notes.data = [{ id: 'n1', title: 'Long', content: 'line\n'.repeat(200), isPinned: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }]
    useNotesStore.setState({ selectedNoteId: 'n1' })
    render(<NotesDrawer />)
    const body = screen.getByPlaceholderText('Write something...')
    const viewport = body.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!
    // A browser clamps the viewport's scroll position while the textarea is collapsed for measuring
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => {
        viewport.scrollTop = 0
        return 4000
      },
    })
    viewport.scrollTop = 1200

    fireEvent.change(body, { target: { value: `${'line\n'.repeat(200)}x` } })

    expect(viewport.scrollTop).toBe(1200)
  })
})

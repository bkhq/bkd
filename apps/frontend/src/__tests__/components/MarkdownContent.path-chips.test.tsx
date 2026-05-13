import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '@/components/issue-detail/MarkdownContent'

// MarkdownContent lazy-imports ShikiCodeBlock + MermaidDiagram. The inline-
// code path-chip code path never triggers either of them, but their lazy
// chunks resolve asynchronously in jsdom and add noise — stub them to
// stable no-ops so the tests stay deterministic.
vi.mock('@/components/files/ShikiCodeBlock', () => ({
  ShikiCodeBlock: ({ code }: { code: string }) => <pre data-testid="shiki">{code}</pre>,
}))
vi.mock('@/components/MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid">{code}</div>,
}))

// ────────────────────────────────────────────────────────────────────────────
// CHAT-008 follow-up regression. Pins the "AI wraps file paths in backticks"
// fix from commit d3b907f: an inline <code> whose entire content trims to a
// single known path renders as a clickable PathChip instead of a static
// <code>. Without these tests, a future refactor to the renderCode callback
// (or to splitByKnownPaths' single-segment contract) would silently break
// the most common path-mention shape in real AI output.
// ────────────────────────────────────────────────────────────────────────────

describe('markdownContent inline-code path chip', () => {
  it('replaces `path` inline code with a clickable chip when path is in knownPaths', () => {
    const onPathClick = vi.fn()
    render(
      <MarkdownContent
        content="See `src/foo.ts` for the implementation."
        knownPaths={['src/foo.ts']}
        onPathClick={onPathClick}
      />,
    )
    const chip = screen.getByRole('button', { name: 'src/foo.ts' })
    expect(chip).toBeTruthy()
    // The chip is rendered INSTEAD of a <code> wrapper — no nested
    // code-style on the same content.
    expect(chip.tagName).toBe('BUTTON')
  })

  it('clicking the chip invokes onPathClick with the path', () => {
    const onPathClick = vi.fn()
    render(
      <MarkdownContent
        content="`apps/api/server.ts`"
        knownPaths={['apps/api/server.ts']}
        onPathClick={onPathClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'apps/api/server.ts' }))
    expect(onPathClick).toHaveBeenCalledTimes(1)
    expect(onPathClick).toHaveBeenCalledWith('apps/api/server.ts', undefined)
  })

  it('captures :LINE suffix inside inline code and forwards it to onPathClick', () => {
    const onPathClick = vi.fn()
    render(
      <MarkdownContent
        content="`apps/api/server.ts:42`"
        knownPaths={['apps/api/server.ts']}
        onPathClick={onPathClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'apps/api/server.ts:42' }))
    expect(onPathClick).toHaveBeenCalledWith('apps/api/server.ts', 42)
  })

  it('leaves inline code untouched when its content is not a known path', () => {
    const onPathClick = vi.fn()
    render(
      <MarkdownContent
        content="call `someFunction()` then return"
        knownPaths={['src/foo.ts']}
        onPathClick={onPathClick}
      />,
    )
    // No button. The text stays as inline <code>.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('someFunction()').tagName).toBe('CODE')
  })

  it('does not chip-ify inline code with extra surrounding text', () => {
    // Guard: only convert when the ENTIRE trimmed content is a single
    // known path. `src/foo.ts and other notes` must NOT become a chip
    // even though `src/foo.ts` is in the whitelist, because the chip
    // would lose the surrounding context.
    const onPathClick = vi.fn()
    render(
      <MarkdownContent
        content="`src/foo.ts and other notes`"
        knownPaths={['src/foo.ts']}
        onPathClick={onPathClick}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders normal inline code when knownPaths is empty', () => {
    // Without a whitelist there's nothing to chip-match against. The
    // renderer must short-circuit and produce the default <code>.
    render(<MarkdownContent content="hello `world`" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('world').tagName).toBe('CODE')
  })
})

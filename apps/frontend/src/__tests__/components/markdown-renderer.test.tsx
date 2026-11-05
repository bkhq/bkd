import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from '@/components/files/MarkdownRenderer'

/** File-browser Markdown preview on streamdown (UI-010). */

vi.mock('@/components/files/ShikiCodeBlock', () => ({
  ShikiCodeBlock: ({ code, lang }: { code: string, lang: string }) => (
    <pre data-testid="shiki" data-lang={lang}>{code}</pre>
  ),
}))

describe('markdownRenderer', () => {
  it('renders GFM and inline HTML, stripping scripts', () => {
    const md = [
      '# Title',
      '<p align="center"><img src="https://cdn.example.com/logo.png" width="120"></p>',
      '- [x] done',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '<script>window.pwned = true</script>',
    ].join('\n\n')
    const { container } = render(<MarkdownRenderer content={md} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title')
    expect(container.querySelector('img')).toHaveAttribute('width', '120')
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked()
    expect(container.querySelectorAll('td')).toHaveLength(2)
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders links as plain anchors opening in a new tab', () => {
    render(<MarkdownRenderer content="See [docs](https://example.com/docs)." />)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('routes fenced code to ShikiCodeBlock', () => {
    render(<MarkdownRenderer content={'\`\`\`json\n{"a":1}\n\`\`\`'} />)
    expect(screen.getByTestId('shiki')).toHaveAttribute('data-lang', 'json')
  })

  it('shows leading YAML frontmatter as a YAML block instead of a heading', () => {
    render(<MarkdownRenderer content={'---\nname: pma\ndescription: Project management\n---\n\n# Body'} />)
    expect(screen.getByTestId('shiki')).toHaveAttribute('data-lang', 'yaml')
    expect(screen.getByTestId('shiki')).toHaveTextContent('name: pma')
    // The body still renders; the YAML does not become a heading
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Body'])
  })
})

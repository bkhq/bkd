import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from '@/components/files/MarkdownRenderer'
import { kanbanApi } from '@/lib/kanban-api'

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

  it('resolves relative images against the file directory via the raw API', () => {
    const md = '![a](./img/a.png) ![b](../shared/b.png) <img src="c.png"> ![abs](/x.png) ![ext](https://h/y.png)'
    const { container } = render(
      <MarkdownRenderer content={md} root="/ws/proj" path="docs/guide/README.md" />,
    )
    const srcs = Array.from(container.querySelectorAll('img')).map(i => i.getAttribute('src'))
    expect(srcs).toEqual([
      kanbanApi.rawFileUrl('/ws/proj', 'docs/guide/img/a.png'),
      kanbanApi.rawFileUrl('/ws/proj', 'docs/shared/b.png'),
      kanbanApi.rawFileUrl('/ws/proj', 'docs/guide/c.png'),
      '/x.png',
      'https://h/y.png',
    ])
  })
})

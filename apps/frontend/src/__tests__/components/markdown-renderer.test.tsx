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

  it('decodes percent-escapes and non-ASCII names once before hitting the raw API', () => {
    const md = '![a](./img/a%20b.png) <img src="图 1.png"> ![bad](d%zz.png) ![mixed](my%20d%zz.png) ![cut](%E4%B8.png)'
    const { container } = render(
      <MarkdownRenderer content={md} root="/ws/proj" path="my docs/guide/README.md" />,
    )
    const srcs = Array.from(container.querySelectorAll('img')).map(i => i.getAttribute('src'))
    expect(srcs).toEqual([
      kanbanApi.rawFileUrl('/ws/proj', 'my docs/guide/img/a b.png'),
      kanbanApi.rawFileUrl('/ws/proj', 'my docs/guide/图 1.png'),
      kanbanApi.rawFileUrl('/ws/proj', 'my docs/guide/d%zz.png'),
      kanbanApi.rawFileUrl('/ws/proj', 'my docs/guide/my d%zz.png'),
      kanbanApi.rawFileUrl('/ws/proj', 'my docs/guide/%E4%B8.png'),
    ])
  })

  it('does not reuse the previous file directory when another file is previewed', () => {
    const first = render(<MarkdownRenderer content="![a](a.png)" root="/ws/proj" path="one/README.md" />)
    expect(first.container.querySelector('img')).toHaveAttribute('src', kanbanApi.rawFileUrl('/ws/proj', 'one/a.png'))
    first.unmount()
    const second = render(<MarkdownRenderer content="![a](a.png)" root="/ws/proj" path="two/README.md" />)
    expect(second.container.querySelector('img')).toHaveAttribute('src', kanbanApi.rawFileUrl('/ws/proj', 'two/a.png'))
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

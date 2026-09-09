import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '@/components/issue-detail/MarkdownContent'

// ShikiCodeBlock loads the Shiki bundle; the renderer only needs to route to it.
vi.mock('@/components/files/ShikiCodeBlock', () => ({
  ShikiCodeBlock: ({ code, lang }: { code: string, lang: string }) => (
    <pre data-testid="shiki" data-lang={lang}>{code}</pre>
  ),
}))

describe('markdownContent', () => {
  it('renders markdown structure as HTML', () => {
    const { container } = render(
      <MarkdownContent content={'# Title\n\nSome **bold** text and `inline`.\n\n- one\n- two'} />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title')
    expect(container.querySelector('[data-streamdown="strong"]')).toHaveTextContent('bold')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('code')).toHaveTextContent('inline')
    expect(container.textContent).not.toContain('**')
  })

  it('renders gfm tables as table elements', () => {
    const { container } = render(
      <MarkdownContent content={'| a | b |\n| - | - |\n| 1 | 2 |'} />,
    )
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })

  it('routes fenced code to ShikiCodeBlock with the fence language', () => {
    render(<MarkdownContent content={'```ts\nconst a = 1\n```'} />)
    const block = screen.getByTestId('shiki')
    expect(block).toHaveAttribute('data-lang', 'ts')
    expect(block).toHaveTextContent('const a = 1')
  })

  it('repairs unterminated emphasis while streaming', () => {
    const { container } = render(<MarkdownContent content="Working on **the fix" isStreaming />)
    expect(container.querySelector('[data-streamdown="strong"]')).toHaveTextContent('the fix')
    expect(container.textContent).not.toContain('**')
  })

  it('renders an unterminated code fence as a code block while streaming', () => {
    render(<MarkdownContent content={'Step one:\n\n```ts\nlet x ='} isStreaming />)
    const block = screen.getByTestId('shiki')
    expect(block).toHaveAttribute('data-lang', 'ts')
    expect(block).toHaveTextContent('let x =')
  })

  it('keeps attachment images renderable', () => {
    const { container } = render(<MarkdownContent content="![shot](/api/files/raw?path=a.png)" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/files/raw?path=a.png')
  })

  it('renders nothing for empty content', () => {
    const { container } = render(<MarkdownContent content="   " />)
    expect(container.textContent).toBe('')
  })
})

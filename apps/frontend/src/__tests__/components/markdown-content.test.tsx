import { act, render, waitFor } from '@testing-library/react'
import DOMPurify from 'dompurify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '@/components/issue-detail/MarkdownContent'
import { codeToHtml } from '@/lib/shiki'

vi.mock('@/lib/shiki', () => ({ codeToHtml: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

describe('markdownContent', () => {
  it('does not sanitize unchanged highlighted HTML on parent renders', async () => {
    vi.mocked(codeToHtml).mockResolvedValue('<pre class="shiki"><code>hello</code></pre>')
    const sanitize = vi.spyOn(DOMPurify, 'sanitize')
    const { container, rerender } = render(<MarkdownContent content="hello" />)
    await waitFor(() => expect(container.querySelector('.shiki')).not.toBeNull())
    sanitize.mockClear()
    rerender(<MarkdownContent content="hello" className="wide" />)
    expect(sanitize).not.toHaveBeenCalled()
  })

  it('keeps the previous highlighted layout until the current update is ready', async () => {
    vi.mocked(codeToHtml).mockResolvedValueOnce('<pre class="shiki"><code>first</code></pre>')
    const { container, rerender } = render(<MarkdownContent content="first" />)
    await waitFor(() => expect(container.querySelector('.shiki')).not.toBeNull())
    let resolve!: (html: string) => void
    vi.mocked(codeToHtml).mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    rerender(<MarkdownContent content="first updated" />)
    expect(container.querySelector('.shiki')).not.toBeNull()
    await act(async () => resolve('<pre class="shiki"><code>first updated</code></pre>'))
    expect(container).toHaveTextContent('first updated')
  })

  it('ignores obsolete highlight results and removes cleared content', async () => {
    let oldResult!: (html: string) => void
    vi.mocked(codeToHtml).mockImplementationOnce(() => new Promise((resolve) => {
      oldResult = resolve
    }))
    const { container, rerender } = render(<MarkdownContent content="old" />)
    vi.mocked(codeToHtml).mockResolvedValueOnce('<pre class="shiki">current<script>alert(1)</script></pre>')
    rerender(<MarkdownContent content="current" />)
    await waitFor(() => expect(container.querySelector('.shiki')).toHaveTextContent('current'))
    await act(async () => oldResult('<pre class="shiki">obsolete</pre>'))
    expect(container).not.toHaveTextContent('obsolete')
    expect(container.querySelector('script')).toBeNull()
    rerender(<MarkdownContent content="" />)
    expect(container).toHaveTextContent('')
    expect(container.querySelector('pre')).toBeNull()
  })
})

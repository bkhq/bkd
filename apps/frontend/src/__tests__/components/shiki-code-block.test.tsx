import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShikiCodeBlock } from '@/components/files/ShikiCodeBlock'
import { codeToHtml } from '@/lib/shiki'

vi.mock('@/lib/shiki', () => ({ codeToHtml: vi.fn() }))

describe('shikiCodeBlock', () => {
  it('strips the tabindex Shiki puts on the code block', async () => {
    // A focusable block swallows long-press-to-select on touch devices.
    vi.mocked(codeToHtml).mockResolvedValue('<pre class="shiki" tabindex="0"><code>hello</code></pre>')
    const { container } = render(<ShikiCodeBlock code="hello" lang="text" />)
    await waitFor(() => expect(container.querySelector('.shiki')).not.toBeNull())
    expect(container.querySelector('[tabindex]')).toBeNull()
  })
})

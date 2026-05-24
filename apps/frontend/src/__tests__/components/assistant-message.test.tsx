import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantMessage } from '@/components/issue-detail/LogEntry'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

// Mock MarkdownContent so we can tell what path the component took:
// raw <div> (bug — bare markdown) vs MarkdownContent (fix — rendered markdown)
vi.mock('@/components/issue-detail/MarkdownContent', () => ({
  MarkdownContent: ({ content, className }: { content: string, className?: string, knownPaths?: unknown, onPathClick?: unknown }) => (
    <div className={className} data-testid="markdown-rendered" data-content={content}>
      {content}
    </div>
  ),
}))

vi.mock('@/hooks/use-file-preview', () => ({
  useFilePreview: () => ({
    knownPaths: new Set<string>(),
    openPreview: vi.fn(),
    hasPreview: false,
  }),
}))

vi.mock('@/components/OpenApiLink', () => ({
  OpenApiLink: ({ url, children }: { url: string, children: React.ReactNode }) => (
    <a href={url}>{children}</a>
  ),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('assistantMessage — streaming display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Regression: preamble streaming blank-screen ──

  it('shows streaming preview when preamble exists but reply is empty', () => {
    const content = `## Goal
- Validate profit report

## Progress
### In Progress
- Checking build status`

    render(<AssistantMessage content={content} isStreaming={true} />)

    // Preamble content visible as streaming preview
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('Validate profit report')
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('Checking build status')
  })

  it('renders via MarkdownContent when streaming is done and reply exists', () => {
    const content = `## Goal
- Validate profit report

## Constraints & Preferences
- Strict alignment

## 修改内容
Actual answer text here.`

    render(<AssistantMessage content={content} isStreaming={false} />)

    // The reply part should render as markdown
    expect(screen.getByTestId('markdown-rendered')).toBeDefined()
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('Actual answer text here')
  })

  // ── Regression: raw markdown visible during streaming ──
  // Before the fix, when isStreaming=true, the reply was rendered as a plain
  // <div> — raw markdown (```php, |---|---|) appeared as bare text on screen.
  // After the fix, MarkdownContent is used for both streaming and final states.

  it('renders reply via MarkdownContent during streaming (not raw text)', () => {
    const content = `## 修改内容
Some real answer being typed`

    render(<AssistantMessage content={content} isStreaming={true} />)

    // Must find the MarkdownContent wrapper — if it rendered raw text,
    // data-testid='markdown-rendered' would not be present on the reply
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('Some real answer being typed')
  })

  it('renders plain content via MarkdownContent during streaming', () => {
    const content = 'This is a plain assistant reply without any preamble.'

    render(<AssistantMessage content={content} isStreaming={true} />)

    // Plain content shows via MarkdownContent, not raw <div>
    expect(screen.getByTestId('markdown-rendered')).toBeDefined()
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('This is a plain assistant reply')
  })

  it('shows preamble progress across accumulating streaming chunks', () => {
    const { rerender } = render(<AssistantMessage content="## Goal\n- analyzing" isStreaming={true} />)
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('analyzing')

    rerender(<AssistantMessage content={'## Goal\n- analyzing\n\n## Constraints & Preferences\n- strict\n\n## Progress\n- checking'} isStreaming={true} />)
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('checking')

    rerender(<AssistantMessage content={'## Goal\n- analyzing\n\n## Constraints & Preferences\n- strict\n\n## Progress\n- checking\n\n## 修改内容\nThe fix is...'} isStreaming={true} />)
    expect(screen.getByTestId('markdown-rendered').textContent).toContain('The fix is')
  })
})

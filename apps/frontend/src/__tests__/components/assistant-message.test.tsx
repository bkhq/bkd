import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantMessage } from '@/components/issue-detail/LogEntry'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

// Mock the file-preview hook used inside AssistantMessage
vi.mock('@/hooks/use-file-preview', () => ({
  useFilePreview: () => ({
    knownPaths: new Set<string>(),
    openPreview: vi.fn(),
    hasPreview: false,
  }),
}))

// Mock OpenAPI link component
vi.mock('@/components/OpenApiLink', () => ({
  OpenApiLink: ({ url, children }: { url: string, children: React.ReactNode }) => (
    <a href={url}>{children}</a>
  ),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('AssistantMessage — streaming display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Regression: preamble streaming blank-screen bug ──
  // Before the fix, when isStreaming=true and splitAssistantPreamble returned
  // reply='' (preamble-only content), nothing rendered at all — users saw a
  // blank bubble for seconds while the preamble accumulated.

  it('shows streaming preview when preamble exists but reply is empty', () => {
    const content = `## Goal
- Validate profit report

## Progress
### In Progress
- Checking build status`

    render(<AssistantMessage content={content} isStreaming={true} />)

    // Preamble content visible as streaming preview
    expect(screen.getByText(/# Goal/)).toBeDefined()
    expect(screen.getByText(/- Validate profit report/)).toBeDefined()
  })

  it('renders normally when streaming is done and reply exists', () => {
    const content = `## Goal
- Validate profit report

## Constraints & Preferences
- Strict alignment

## 修改内容
Actual answer text here.`

    render(<AssistantMessage content={content} isStreaming={false} />)

    // The reply part should render as markdown
    expect(screen.getByText(/Actual answer text here/)).toBeDefined()
  })

  it('shows streaming reply text when reply is non-empty', () => {
    const content = `## Goal
- Validate profit report

## Constraints & Preferences
- Strict alignment

## 修改内容
Some real answer being typed`

    render(<AssistantMessage content={content} isStreaming={true} />)

    // Reply text visible during streaming
    expect(screen.getByText(/Some real answer being typed/)).toBeDefined()
  })

  it('does not show preamble block when preamble is null (no opencode format)', () => {
    const content = 'This is a plain assistant reply without any preamble.'

    render(<AssistantMessage content={content} isStreaming={true} />)

    // Plain content shows as streaming text
    expect(screen.getByText(/This is a plain assistant reply/)).toBeDefined()
  })

  it('shows preamble progress across accumulating streaming chunks', () => {
    // Simulate 3 streaming snapshots — the component should show content
    // at each stage, not go blank.

    // Stage 1: partial preamble
    const { rerender } = render(<AssistantMessage content="## Goal\n- analyzing" isStreaming={true} />)
    expect(screen.getByText(/- analyzing/)).toBeDefined()

    // Stage 2: more preamble sections accumulated, still no reply
    rerender(<AssistantMessage content={'## Goal\n- analyzing\n\n## Constraints & Preferences\n- strict\n\n## Progress\n- checking'} isStreaming={true} />)
    expect(screen.getByText(/- checking/)).toBeDefined()

    // Stage 3: reply content begins
    rerender(<AssistantMessage content={'## Goal\n- analyzing\n\n## Constraints & Preferences\n- strict\n\n## Progress\n- checking\n\n## 修改内容\nThe fix is...'} isStreaming={true} />)
    expect(screen.getByText(/The fix is/)).toBeDefined()
  })
})

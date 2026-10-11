import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'

/** Engine error entries name their error kind so a policy block is readable. */

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))
vi.mock('react-router-dom', () => ({ useParams: () => ({}) }))

describe('logEntry error-message', () => {
  it('labels a known error kind', async () => {
    await i18n.changeLanguage('en')
    render(
      <LogEntry
        entry={{
          entryType: 'error-message',
          content: 'This content was flagged for possible cybersecurity risk.',
          metadata: { errorKind: 'cyberPolicy', willRetry: false },
        }}
      />,
    )

    expect(screen.getByText('Blocked by the cybersecurity policy')).toBeInTheDocument()
    expect(screen.getByText(/flagged for possible cybersecurity risk/)).toBeInTheDocument()
  })

  it('falls back to the raw kind for an unknown one', async () => {
    await i18n.changeLanguage('en')
    render(
      <LogEntry
        entry={{ entryType: 'error-message', content: 'x', metadata: { errorKind: 'somethingNew' } }}
      />,
    )

    expect(screen.getByText('somethingNew')).toBeInTheDocument()
  })

  it('renders plain errors unchanged', () => {
    render(<LogEntry entry={{ entryType: 'error-message', content: 'Turn failed' }} />)

    expect(screen.getByText('Turn failed')).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDuration, formatElapsed, formatFileSize, formatModelName, formatTokenCount, getProjectInitials } from '../../lib/format'

describe('formatFileSize', () => {
  it('formats bytes below 1024', () => {
    expect(formatFileSize(500)).toBe('500B')
  })

  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0KB')
  })

  it('formats kilobytes with decimals', () => {
    expect(formatFileSize(2560)).toBe('2.5KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0MB')
  })

  it('formats megabytes with decimals', () => {
    expect(formatFileSize(5242880)).toBe('5.0MB')
  })
})

describe('formatModelName', () => {
  it('formats claude opus model', () => {
    expect(formatModelName('claude-opus-4-6')).toBe('Claude Opus 4.6')
  })

  it('formats claude sonnet model', () => {
    expect(formatModelName('claude-sonnet-4-5')).toBe('Claude Sonnet 4.5')
  })

  it('formats claude haiku model', () => {
    expect(formatModelName('claude-haiku-3-5')).toBe('Claude Haiku 3.5')
  })

  it('returns unknown model IDs unchanged', () => {
    expect(formatModelName('gpt-4o')).toBe('gpt-4o')
  })

  it('handles model with suffix', () => {
    expect(formatModelName('claude-opus-4-5[thinking]')).toBe('Claude Opus 4.5[thinking]')
  })
})

describe('getProjectInitials', () => {
  it('returns first 2 chars uppercase for single word', () => {
    expect(getProjectInitials('hello')).toBe('HE')
  })

  it('returns initials for multi-word name', () => {
    expect(getProjectInitials('My Project')).toBe('MP')
  })

  it('returns ?? for empty string', () => {
    expect(getProjectInitials('')).toBe('??')
  })

  it('returns ?? for whitespace-only string', () => {
    expect(getProjectInitials('   ')).toBe('??')
  })

  it('handles three-word name (uses first two)', () => {
    expect(getProjectInitials('A Big Project')).toBe('AB')
  })

  it('uppercases lowercase initials', () => {
    expect(getProjectInitials('my project')).toBe('MP')
  })
})

describe('formatTokenCount', () => {
  it('shows small counts as-is', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
  })

  it('formats thousands with one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(12345)).toBe('12.3k')
    expect(formatTokenCount(999949)).toBe('999.9k')
  })

  it('formats millions with one decimal', () => {
    expect(formatTokenCount(1000000)).toBe('1.0M')
    expect(formatTokenCount(2560000)).toBe('2.6M')
  })
})

describe('formatFileSize gigabytes', () => {
  it('formats gigabytes', () => {
    expect(formatFileSize(1024 ** 3)).toBe('1.0GB')
  })
})

describe('formatDateTime', () => {
  it('renders a dash for a missing value', () => {
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
    expect(formatDateTime('')).toBe('-')
  })

  it('renders a dash for an unparseable value', () => {
    expect(formatDateTime('not a date')).toBe('-')
  })

  it('treats a number as a unix timestamp in seconds', () => {
    expect(formatDateTime(1787382217)).toBe(new Date(1787382217000).toLocaleString())
  })
})

describe('formatDuration', () => {
  it('renders milliseconds below a second', () => {
    expect(formatDuration(500)).toBe('500ms')
  })

  it('renders seconds with one decimal', () => {
    expect(formatDuration(1500)).toBe('1.5s')
  })

  it('renders minutes and seconds past a minute', () => {
    expect(formatDuration(90_000)).toBe('1m30s')
    expect(formatDuration(180_000)).toBe('3m0s')
  })

  it('renders a dash for a missing value', () => {
    expect(formatDuration(null)).toBe('-')
  })
})

describe('formatElapsed', () => {
  it('is empty without a timestamp', () => {
    expect(formatElapsed(null)).toBe('')
  })

  it('renders seconds, minutes and hours', () => {
    const now = Date.now()
    expect(formatElapsed(new Date(now - 45_000).toISOString())).toBe('45s')
    expect(formatElapsed(new Date(now - 192_000).toISOString())).toBe('3m 12s')
    expect(formatElapsed(new Date(now - 7_500_000).toISOString())).toBe('2h 5m')
  })
})

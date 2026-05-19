import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityStream } from '@/components/cockpit/ActivityStream'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

type Listener = (data: {
  issueId: string
  changes: Record<string, unknown>
  title?: string
  projectAlias?: string
  source?: string
}) => void

const listeners = new Set<Listener>()

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    onIssueUpdated: (l: Listener) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    onIssueActivity: () => () => {},
  },
}))

function fire(data: Parameters<Listener>[0]) {
  act(() => {
    for (const l of listeners) l(data)
  })
}

describe('activityStream', () => {
  beforeEach(() => {
    listeners.clear()
  })

  it('shows empty state initially', () => {
    render(<MemoryRouter><ActivityStream /></MemoryRouter>)
    expect(screen.getByTestId('cockpit-activity-empty')).toBeDefined()
  })

  it('appends an item when an issue-updated event fires', () => {
    render(<MemoryRouter><ActivityStream /></MemoryRouter>)
    fire({
      issueId: 'i1',
      changes: { sessionStatus: 'running' },
      title: 'My Issue',
      projectAlias: 'alpha',
      source: 'engine',
    })
    expect(screen.getByText('My Issue')).toBeDefined()
  })

  it('dedupes consecutive events for the same issue', () => {
    render(<MemoryRouter><ActivityStream /></MemoryRouter>)
    fire({ issueId: 'i1', changes: { sessionStatus: 'running' }, title: 'A', projectAlias: 'p' })
    fire({ issueId: 'i1', changes: { sessionStatus: 'completed' }, title: 'A', projectAlias: 'p' })
    const items = screen.getAllByTestId(/^cockpit-activity-item-/)
    expect(items.length).toBe(1)
  })

  it('caps the list at 30 items', () => {
    render(<MemoryRouter><ActivityStream /></MemoryRouter>)
    for (let i = 0; i < 40; i++) {
      fire({ issueId: `i${i}`, changes: { sessionStatus: 'running' }, title: `T${i}`, projectAlias: 'p' })
    }
    const items = screen.getAllByTestId(/^cockpit-activity-item-/)
    expect(items.length).toBe(30)
  })
})

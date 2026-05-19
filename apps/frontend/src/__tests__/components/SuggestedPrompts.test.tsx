import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SuggestedPrompts } from '@/components/cockpit/SuggestedPrompts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

describe('suggestedPrompts', () => {
  it('renders at least three suggestion chips', () => {
    render(<SuggestedPrompts onSelect={() => {}} />)
    const chips = screen.getAllByTestId(/^cockpit-suggested-chip-/)
    expect(chips.length).toBeGreaterThanOrEqual(3)
  })

  it('clicking a chip calls onSelect with the prompt text', () => {
    const onSelect = vi.fn()
    render(<SuggestedPrompts onSelect={onSelect} />)
    const first = screen.getAllByTestId(/^cockpit-suggested-chip-/)[0]
    fireEvent.click(first)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(typeof onSelect.mock.calls[0][0]).toBe('string')
    expect((onSelect.mock.calls[0][0] as string).length).toBeGreaterThan(0)
  })
})

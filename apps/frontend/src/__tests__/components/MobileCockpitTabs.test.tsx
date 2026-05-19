import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileCockpitTabs } from '@/components/cockpit/MobileCockpitTabs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

describe('mobileCockpitTabs', () => {
  it('renders both tabs', () => {
    render(<MobileCockpitTabs mode="list" onChange={() => {}} />)
    expect(screen.getByTestId('cockpit-mobile-tab-list')).toBeDefined()
    expect(screen.getByTestId('cockpit-mobile-tab-cockpit')).toBeDefined()
  })

  it('marks the active tab via aria-selected', () => {
    render(<MobileCockpitTabs mode="cockpit" onChange={() => {}} />)
    const list = screen.getByTestId('cockpit-mobile-tab-list')
    const cockpit = screen.getByTestId('cockpit-mobile-tab-cockpit')
    expect(list.getAttribute('aria-selected')).toBe('false')
    expect(cockpit.getAttribute('aria-selected')).toBe('true')
  })

  it('clicking a tab calls onChange with the value', () => {
    const onChange = vi.fn()
    render(<MobileCockpitTabs mode="list" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('cockpit-mobile-tab-cockpit'))
    expect(onChange).toHaveBeenCalledWith('cockpit')
  })
})

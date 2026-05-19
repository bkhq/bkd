import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AssistantFab } from '@/components/cockpit/AssistantFab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/components/cockpit/AssistantPanel', () => ({
  AssistantPanel: ({ open, onClose }: { open: boolean, onClose: () => void }) =>
    open ?
        <div data-testid="assistant-panel-stub" onClick={onClose}>panel-open</div> :
      null,
}))

describe('assistantFab', () => {
  it('renders the FAB closed by default', () => {
    render(<AssistantFab />)
    expect(screen.getByTestId('cockpit-assistant-fab')).toBeDefined()
    expect(screen.queryByTestId('assistant-panel-stub')).toBeNull()
  })

  it('clicking the FAB opens the panel', () => {
    render(<AssistantFab />)
    fireEvent.click(screen.getByTestId('cockpit-assistant-fab'))
    expect(screen.getByTestId('assistant-panel-stub')).toBeDefined()
  })

  it('panel onClose closes the panel again', () => {
    render(<AssistantFab />)
    fireEvent.click(screen.getByTestId('cockpit-assistant-fab'))
    fireEvent.click(screen.getByTestId('assistant-panel-stub'))
    expect(screen.queryByTestId('assistant-panel-stub')).toBeNull()
  })
})

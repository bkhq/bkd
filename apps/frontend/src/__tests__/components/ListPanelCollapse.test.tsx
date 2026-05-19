import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewModeStore } from '@/stores/view-mode-store'

import { ListPanelGhost } from '@/components/issue-detail/ListPanelGhost'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

describe('view-mode-store: listPanelCollapsed', () => {
  beforeEach(() => {
    useViewModeStore.setState({ listPanelCollapsed: false })
  })

  it('toggles the collapsed state', () => {
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(false)
    useViewModeStore.getState().toggleListPanel()
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(true)
    useViewModeStore.getState().toggleListPanel()
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(false)
  })

  it('setListPanelCollapsed sets explicit value', () => {
    useViewModeStore.getState().setListPanelCollapsed(true)
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(true)
    useViewModeStore.getState().setListPanelCollapsed(false)
    expect(useViewModeStore.getState().listPanelCollapsed).toBe(false)
  })
})

describe('listPanelGhost', () => {
  it('renders a narrow strip with an expand button', () => {
    const onExpand = vi.fn()
    render(<ListPanelGhost onExpand={onExpand} />)
    const strip = screen.getByTestId('list-panel-ghost')
    expect(strip).toBeDefined()
    const btn = screen.getByTestId('list-panel-ghost-expand')
    fireEvent.click(btn)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('strip width is 14px', () => {
    render(<ListPanelGhost onExpand={() => {}} />)
    const strip = screen.getByTestId('list-panel-ghost') as HTMLElement
    expect(strip.style.width).toBe('14px')
  })
})

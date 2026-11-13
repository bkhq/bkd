import { fireEvent, render, screen } from '@testing-library/react'
import { Settings } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { SettingsLayout } from '@/components/ui/settings-layout'

const items = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'logs', label: 'Logs', icon: Settings },
]

function renderAt(item: string) {
  render(
    <SettingsLayout open onOpenChange={() => {}} title="Settings" items={items} defaultItem={item} fillItems={['logs']}>
      {active => <p>{`body:${active}`}</p>}
    </SettingsLayout>,
  )
  return screen.getByText(`body:${item}`)
}

describe('settingsLayout', () => {
  it('scrolls a section in the ScrollArea', () => {
    expect(renderAt('general').closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
  })

  it('lets a fill section manage its own scrolling', () => {
    expect(renderAt('logs').closest('[data-slot="scroll-area-viewport"]')).toBeNull()
  })

  it('starts each section with a fresh scroll area, not the previous one\'s scroll state', () => {
    const items3 = [...items, { id: 'models', label: 'Models', icon: Settings }]
    render(
      <SettingsLayout open onOpenChange={() => {}} title="Settings" items={items3} defaultItem="general">
        {active => <p>{`body:${active}`}</p>}
      </SettingsLayout>,
    )
    const first = screen.getByText('body:general').closest('[data-slot="scroll-area-viewport"]')!
    first.scrollTop = 300
    fireEvent.click(screen.getAllByText('Models')[0])
    const next = screen.getByText('body:models').closest('[data-slot="scroll-area-viewport"]')!
    expect(next).not.toBe(first)
    expect(next.scrollTop).toBe(0)
  })
})

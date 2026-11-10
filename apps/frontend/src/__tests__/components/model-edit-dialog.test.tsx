import type { EngineModel, ModelConfig, VirtualEngine } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelEditDialog } from '@/components/settings/ModelEditDialog'
import { VirtualEngineDialog } from '@/components/settings/VirtualEngineDialog'
import i18n from '@/i18n'

const mocks = vi.hoisted(() => ({
  setConfigs: vi.fn(),
  setVirtual: vi.fn(),
}))

vi.mock('@/hooks/use-kanban', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/use-kanban')>(),
  useSetModelConfigs: () => ({ mutate: mocks.setConfigs, isPending: false, error: null }),
  useSetVirtualEngines: () => ({ mutate: mocks.setVirtual, isPending: false, error: null }),
}))

const MODELS: EngineModel[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', isDefault: true },
  { id: 'claude-fable-5-2', name: 'Fable 5.2' },
  { id: 'fable-high', name: 'Fable high', custom: true },
]
const CONFIGS: ModelConfig[] = [
  { id: 'fable-high', name: 'Fable high', baseModel: 'claude-fable-5-2', envVars: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } },
]
const target = (modelId: string | null) => ({ engineType: 'claude-code', engineName: 'Claude Code', modelId })

describe('model edit dialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.setConfigs.mockReset()
    mocks.setVirtual.mockReset()
  })

  it('saves a detected model\'s name and env vars as an override', () => {
    render(<ModelEditDialog target={target('claude-opus-5-5')} models={MODELS} configs={CONFIGS} onClose={() => {}} />)
    expect(screen.queryByText('Base model')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Opus 5.5'), { target: { value: 'Opus (team)' } })
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'CLAUDE_CODE_EFFORT_LEVEL=medium' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.setConfigs).toHaveBeenCalledWith({
      engineType: 'claude-code',
      configs: [
        CONFIGS[0],
        { id: 'claude-opus-5-5', name: 'Opus (team)', envVars: { CLAUDE_CODE_EFFORT_LEVEL: 'medium' } },
      ],
    }, expect.anything())
  })

  it('creates a custom model on the default base model', () => {
    render(<ModelEditDialog target={target(null)} models={MODELS} configs={[]} onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('fable-high'), { target: { value: 'opus-max' } })
    fireEvent.change(screen.getAllByRole('textbox')[2]!, { target: { value: 'CLAUDE_CODE_EFFORT_LEVEL=max' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.setConfigs).toHaveBeenCalledWith({
      engineType: 'claude-code',
      configs: [{ id: 'opus-max', baseModel: 'claude-opus-5-5', envVars: { CLAUDE_CODE_EFFORT_LEVEL: 'max' } }],
    }, expect.anything())
  })

  it('deletes a custom model', () => {
    render(<ModelEditDialog target={target('fable-high')} models={MODELS} configs={CONFIGS} onClose={() => {}} />)
    expect(screen.getByDisplayValue('CLAUDE_CODE_EFFORT_LEVEL=high')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.setConfigs).toHaveBeenCalledWith({ engineType: 'claude-code', configs: [] }, expect.anything())
  })
})

describe('virtual engine dialog', () => {
  const GLM: VirtualEngine = { id: 'glm', name: 'GLM', baseEngine: 'claude-code', baseUrl: 'https://example.com', envVars: {} }

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.setVirtual.mockReset()
  })

  it('edits one engine and keeps the others', () => {
    const other: VirtualEngine = { ...GLM, id: 'other', name: 'Other' }
    render(<VirtualEngineDialog target={{ engineId: 'glm' }} engines={[other, GLM]} onClose={() => {}} />)
    fireEvent.change(screen.getByDisplayValue('GLM'), { target: { value: 'GLM 4.6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.setVirtual).toHaveBeenCalledWith([other, { ...GLM, name: 'GLM 4.6' }], expect.anything())
  })
})

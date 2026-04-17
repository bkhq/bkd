import type {
  EngineAvailability,
  EngineExecutor,
  EngineModel,
  EngineRegistry,
  EngineType,
} from '@/engines/types'
import { logger } from '@/logger'
import { AcpExecutor } from './acp'
import { ClaudeCodeExecutor } from './claude'
import { ClaudeCodeSdkExecutor } from './claude-sdk'
import { CodexExecutor } from './codex'

// Re-export executor classes
export { AcpExecutor } from './acp'
export { ClaudeCodeExecutor } from './claude'
export { ClaudeCodeSdkExecutor } from './claude-sdk'
export { CodexExecutor } from './codex'

/**
 * Backend selector for the `claude-code` engine. Controlled by
 * `CLAUDE_ENGINE_BACKEND` env var:
 *   - `sdk`    — Anthropic's `@anthropic-ai/claude-agent-sdk` (migration target)
 *   - `legacy` — hand-rolled stream-json executor (default during rollout)
 *
 * See PLAN-003.
 */
export type ClaudeBackend = 'sdk' | 'legacy'

export function getClaudeBackend(): ClaudeBackend {
  const raw = (process.env.CLAUDE_ENGINE_BACKEND ?? '').trim().toLowerCase()
  if (raw === 'sdk') return 'sdk'
  if (raw === 'legacy') return 'legacy'
  return 'legacy'
}

export function createClaudeExecutor(): EngineExecutor {
  const backend = getClaudeBackend()
  if (backend === 'sdk') {
    logger.info({ backend }, 'claude_backend_selected')
    return new ClaudeCodeSdkExecutor()
  }
  logger.info({ backend }, 'claude_backend_selected')
  return new ClaudeCodeExecutor()
}

/**
 * Default engine registry — manages all executor instances.
 */
class DefaultEngineRegistry implements EngineRegistry {
  private executors = new Map<EngineType, EngineExecutor>()

  register(executor: EngineExecutor): void {
    this.executors.set(executor.engineType, executor)
  }

  get(engineType: EngineType): EngineExecutor | undefined {
    // Direct match first
    const direct = this.executors.get(engineType)
    if (direct) return direct

    // Virtual ACP engine types (e.g. "acp:codex") resolve to the ACP executor
    if (engineType.startsWith('acp:')) {
      return this.executors.get('acp' as EngineType)
    }

    return undefined
  }

  getAll(): EngineExecutor[] {
    return [...this.executors.values()]
  }

  async getAvailable(): Promise<EngineAvailability[]> {
    const results = await Promise.all(this.getAll().map(executor => executor.getAvailability()))
    return results
  }

  async getModels(engineType: EngineType): Promise<EngineModel[]> {
    // Resolve virtual ACP types to base 'acp' executor
    const lookupType = engineType.startsWith('acp:') ? ('acp' as EngineType) : engineType
    const executor = this.executors.get(lookupType)
    if (!executor) return []
    return executor.getModels()
  }
}

// Create and populate the singleton registry
export const engineRegistry: EngineRegistry = createRegistry()

function createRegistry(): EngineRegistry {
  const registry = new DefaultEngineRegistry()

  // Register all supported executors
  registry.register(createClaudeExecutor())
  registry.register(new CodexExecutor())
  registry.register(new AcpExecutor())

  return registry
}

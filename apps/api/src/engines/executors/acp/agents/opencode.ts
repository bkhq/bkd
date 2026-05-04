import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineAvailability } from '@/engines/types'
import type { AcpAgentDefinition } from './base'
import { verifyAcpCommand } from './base'

function getOpencodeAuthStatus(): EngineAvailability['authStatus'] {
  // opencode stores provider credentials inside its config file rather than a
  // single canonical env var. Treat the presence of opencode.json as the
  // "configured" signal — users without any providers wired up will see the
  // failure when execution starts.
  const home = process.env.HOME ?? '/root'
  const configPaths = [
    join(home, '.config', 'opencode', 'opencode.json'),
    join(home, '.opencode', 'opencode.json'),
  ]
  return configPaths.some(p => existsSync(p)) ? 'authenticated' : 'unauthenticated'
}

export const opencodeAgent: AcpAgentDefinition = {
  id: 'opencode',
  label: 'OpenCode',
  commandName: 'opencode',
  npxFallback: ['npx', '-y', 'opencode-ai@latest'],
  acpArgs: ['acp'],
  authStatus: getOpencodeAuthStatus,
  verify: async (cmd) => {
    const binaryPath = cmd[0] === 'npx' ? undefined : cmd[0]
    return verifyAcpCommand(cmd, ['--version'], binaryPath)
  },
}

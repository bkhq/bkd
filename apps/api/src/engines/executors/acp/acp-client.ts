import type { EngineAttachment, EngineModel, PermissionPolicy, SpawnedProcess } from '@/engines/types'
import { AcpLogNormalizer, normalizeAcpEvent } from './normalizer'
import { AcpProtocolHandler, toEngineModels } from './protocol-handler'
import { createSubprocessFromChild, spawnAcpChild } from './transport'
import type { AcpEvent } from './types'

export type { AcpEvent }
export { AcpLogNormalizer, normalizeAcpEvent }

export async function spawnAcpProcess(options: {
  cmd: string[]
  workingDir: string
  prompt: string
  permissionMode: PermissionPolicy
  model?: string
  env?: Record<string, string>
  sessionId?: string
  attachments?: EngineAttachment[]
}): Promise<SpawnedProcess> {
  const child = spawnAcpChild(
    options.cmd,
    options.workingDir,
    options.env,
  )

  const subprocess = createSubprocessFromChild(child)
  const handler = new AcpProtocolHandler(child, options.permissionMode)
  await handler.initialize()
  await handler.startSession(
    options.workingDir,
    options.model,
    options.sessionId,
  )
  handler.sendUserMessage(options.prompt, options.attachments).catch(() => {
    // Errors are already emitted to the event sink by runPrompt().
  })

  return {
    subprocess,
    stdout: handler.stdout,
    stderr: subprocess.stderr,
    cancel: () => {
      void handler.interrupt()
    },
    protocolHandler: {
      interrupt: () => handler.interrupt(),
      close: () => handler.close(),
      sendUserMessage: (content: string, attachments?: EngineAttachment[]) => {
        void handler.sendUserMessage(content, attachments)
      },
      onActivity: undefined,
    },
    externalSessionId: handler.currentSessionId,
    spawnCommand: options.cmd.join(' '),
  }
}

export async function queryAcpModels(options: {
  cmd: string[]
  workingDir: string
  env?: Record<string, string>
}): Promise<EngineModel[]> {
  const child = spawnAcpChild(
    options.cmd,
    options.workingDir,
    options.env,
  )
  const subprocess = createSubprocessFromChild(child)
  const handler = new AcpProtocolHandler(child, 'auto')

  try {
    await handler.initialize()
    const response = await handler.startSession(options.workingDir, undefined)
    return toEngineModels(response)
  } finally {
    handler.close()
    subprocess.kill(15)
    await subprocess.exited.catch(() => {})
  }
}

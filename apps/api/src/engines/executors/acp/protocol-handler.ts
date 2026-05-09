import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type {
  ContentBlock,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable, Writable } from 'node:stream'
import type { EngineAttachment, EngineModel, PermissionPolicy } from '@/engines/types'
import { logger } from '@/logger'
import { createEventSink } from './transport'
import type { AcpEvent, SessionBootstrap } from './types'

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

function mapSessionMode(policy: PermissionPolicy): string {
  switch (policy) {
    case 'plan':
      return 'plan'
    case 'auto':
      return 'yolo'
    case 'supervised':
    default:
      return 'default'
  }
}

function buildPermissionResponse(
  policy: PermissionPolicy,
  params: RequestPermissionRequest,
): RequestPermissionResponse {
  if (policy === 'plan') {
    return { outcome: { outcome: 'cancelled' } }
  }

  const selected = params.options[0]
  if (!selected) {
    return { outcome: { outcome: 'cancelled' } }
  }

  return {
    outcome: {
      outcome: 'selected',
      optionId: selected.optionId,
    },
  }
}

export function toEngineModels(
  response: SessionBootstrap | undefined,
): EngineModel[] {
  return (
    response?.models?.availableModels?.map(model => ({
      id: model.modelId,
      name: model.name,
      description: model.description ?? undefined,
      isDefault: model.modelId === response.models?.currentModelId,
    })) ?? []
  )
}

function sanitizeModels(
  models: SessionBootstrap['models'],
): AcpEvent['models'] {
  if (!models) return undefined

  return {
    currentModelId: models.currentModelId ?? undefined,
    availableModels: models.availableModels?.map(model => ({
      modelId: model.modelId,
      name: model.name,
      description: model.description ?? undefined,
    })),
  }
}

function sanitizeModes(
  modes: SessionBootstrap['modes'],
): AcpEvent['modes'] {
  if (!modes) return undefined

  return {
    currentModeId: modes.currentModeId ?? undefined,
    availableModes: modes.availableModes?.map(mode => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    })),
  }
}

export class AcpProtocolHandler {
  private readonly sink = createEventSink()
  private readonly stream: ReturnType<typeof ndJsonStream>
  private readonly connection: ClientSideConnection

  private sessionId: string | undefined
  private ignoreSessionUpdates = false
  private currentPrompt: Promise<void> = Promise.resolve()

  onActivity?: () => void

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly permissionMode: PermissionPolicy,
  ) {
    this.stream = ndJsonStream(
      Writable.toWeb(this.child.stdin),
      Readable.toWeb(this.child.stdout) as unknown as ReadableStream<Uint8Array>,
    )
    this.connection = new ClientSideConnection(() => ({
      sessionUpdate: async (params: SessionNotification) => {
        this.onActivity?.()
        if (this.ignoreSessionUpdates) return
        this.sink.emit({
          type: 'acp-session-update',
          timestamp: new Date().toISOString(),
          sessionId: params.sessionId,
          update: params.update,
        })
      },
      requestPermission: async (params: RequestPermissionRequest) => {
        return buildPermissionResponse(this.permissionMode, params)
      },
    }), this.stream)
    void this.connection.closed.finally(() => {
      this.sink.close()
    })
  }

  get stdout(): ReadableStream<Uint8Array> {
    return this.sink.stream
  }

  get currentSessionId(): string | undefined {
    return this.sessionId
  }

  async initialize(): Promise<void> {
    const init = await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })

    this.sink.emit({
      type: 'acp-init',
      timestamp: new Date().toISOString(),
      agentInfo: init.agentInfo as Record<string, unknown>,
    })
  }

  async startSession(
    cwd: string,
    model: string | undefined,
    existingSessionId?: string,
  ): Promise<SessionBootstrap> {
    let response: SessionBootstrap

    if (existingSessionId) {
      this.ignoreSessionUpdates = true
      response = await this.connection.loadSession({
        sessionId: existingSessionId,
        cwd,
        mcpServers: [],
      })
      this.sessionId = existingSessionId
      this.sink.emit({
        type: 'acp-session-load',
        timestamp: new Date().toISOString(),
        sessionId: existingSessionId,
        models: sanitizeModels(response.models),
        modes: sanitizeModes(response.modes),
      })
    } else {
      const newResponse = await this.connection.newSession({
        cwd,
        mcpServers: [],
      })
      response = newResponse
      this.sessionId = newResponse.sessionId
      this.sink.emit({
        type: 'acp-session-start',
        timestamp: new Date().toISOString(),
        sessionId: newResponse.sessionId,
        models: sanitizeModels(newResponse.models),
        modes: sanitizeModes(newResponse.modes),
      })
    }

    await this.applySessionConfig(model)
    this.ignoreSessionUpdates = false

    return response
  }

  async sendUserMessage(prompt: string, attachments?: EngineAttachment[]): Promise<void> {
    this.currentPrompt = this.currentPrompt
      .catch(() => {})
      .then(() => this.runPrompt(prompt, attachments))

    return this.currentPrompt
  }

  async interrupt(): Promise<void> {
    if (!this.sessionId) return
    try {
      await this.connection.cancel({ sessionId: this.sessionId })
    } catch {
      // Cancellation is best-effort. The caller escalates to SIGKILL if needed.
    }
  }

  close(): void {
    this.sink.close()
  }

  private async applySessionConfig(model?: string): Promise<void> {
    if (!this.sessionId) return

    const mappedMode = mapSessionMode(this.permissionMode)
    await this.connection.setSessionMode({
      sessionId: this.sessionId,
      modeId: mappedMode,
    }).catch(() => {})

    if (!model) return

    await this.connection.unstable_setSessionModel({
      sessionId: this.sessionId,
      modelId: model,
    }).catch(() => {})
  }

  private async runPrompt(prompt: string, attachments?: EngineAttachment[]): Promise<void> {
    if (!this.sessionId) {
      throw new Error('ACP session is not initialized')
    }

    const startedAt = Date.now()
    this.onActivity?.()

    const contentBlocks: ContentBlock[] = [{ type: 'text', text: prompt }]

    if (attachments?.length) {
      for (const attachment of attachments) {
        const imageBlock = await this.buildImageBlock(attachment)
        if (imageBlock) {
          contentBlocks.push(imageBlock)
        }
      }
    }

    try {
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: contentBlocks,
      })

      this.sink.emit({
        type: 'acp-prompt-result',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        stopReason: result.stopReason,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ACP prompt failed'
      this.sink.emit({
        type: 'acp-error',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        error: message,
      })
      this.sink.emit({
        type: 'acp-prompt-result',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        stopReason: 'error',
        durationMs: Date.now() - startedAt,
        error: message,
      })
    }
  }

  private async buildImageBlock(attachment: EngineAttachment): Promise<ContentBlock | null> {
    const ext = extname(attachment.originalName).toLowerCase()
    const mimeType = IMAGE_MIME_EXTENSIONS[ext] ?? attachment.mimeType

    if (!mimeType?.startsWith('image/')) {
      return null
    }

    try {
      const buffer = await readFile(attachment.absolutePath)
      const base64 = buffer.toString('base64')
      return {
        type: 'image',
        data: base64,
        mimeType,
      }
    } catch (error) {
      logger.warn(
        { attachmentId: attachment.id, path: attachment.absolutePath, error },
        'acp_read_image_failed',
      )
      return null
    }
  }
}

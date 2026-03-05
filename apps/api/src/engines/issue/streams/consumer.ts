import { setAppSetting } from '@/db/helpers'
import {
  refreshSlashCommandsCacheForEngine,
  slashCommandsKey,
} from '@/engines/issue/queries'
import type { ManagedProcess } from '@/engines/issue/types'
import { normalizeStream } from '@/engines/logs'
import type { EngineType, NormalizedLogEntry } from '@/engines/types'
import { logger } from '@/logger'
import { isCancelledNoiseEntry, isTurnCompletionEntry } from './classification'

const MAX_IO_LOG_CHARS = 1200
const IO_LOG_ENABLED = (process.env.LOG_EXECUTOR_IO ?? '1') !== '0'

function clipForLog(input: string): string {
  if (input.length <= MAX_IO_LOG_CHARS) return input
  return `${input.slice(0, MAX_IO_LOG_CHARS)}...<truncated:${input.length - MAX_IO_LOG_CHARS}>`
}

async function saveSlashCommandsToSettings(
  engineType: EngineType,
  commands: string[],
): Promise<void> {
  if (commands.length === 0) return
  await setAppSetting(slashCommandsKey(engineType), JSON.stringify(commands))
  await refreshSlashCommandsCacheForEngine(engineType)
}

export interface StreamCallbacks {
  getManaged: () => ManagedProcess | undefined
  getTurnIndex: () => number
  onEntry: (entry: NormalizedLogEntry) => void
  onTurnCompleted: () => void
  onStreamError: (error: unknown) => void
}

// ---------- Helpers ----------

function pushStderrEntry(
  content: string,
  turnIndex: number,
  onEntry: (entry: NormalizedLogEntry) => void,
): void {
  const entry: NormalizedLogEntry = {
    entryType: 'error-message',
    content,
    turnIndex,
    timestamp: new Date().toISOString(),
  }
  onEntry(entry)
}

// ---------- Stream consumers ----------

export async function consumeStream(
  executionId: string,
  issueId: string,
  stream: ReadableStream<Uint8Array>,
  parser: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null,
  callbacks: StreamCallbacks,
): Promise<void> {
  try {
    for await (const rawEntry of normalizeStream(stream, parser)) {
      try {
        const managed = callbacks.getManaged()
        if (!managed) break
        managed.lastActivityAt = new Date()
        // Clear stall probe if activity resumed after the GC-sent interrupt
        if (managed.stallProbeAt) managed.stallProbeAt = undefined
        const turnIdx = callbacks.getTurnIndex()

        const entry: NormalizedLogEntry = {
          ...rawEntry,
          turnIndex: turnIdx,
          timestamp: rawEntry.timestamp ?? new Date().toISOString(),
        }

        // Extract slash commands from SDK init message
        if (
          entry.entryType === 'system-message' &&
          entry.metadata?.subtype === 'init' &&
          Array.isArray(entry.metadata.slashCommands)
        ) {
          managed.slashCommands = entry.metadata.slashCommands as string[]
          void saveSlashCommandsToSettings(
            managed.engineType,
            managed.slashCommands,
          )
        }

        // Tag all entries in a meta turn so they are hidden from the frontend
        if (managed.metaTurn) {
          entry.metadata = { ...entry.metadata, type: 'system' }
        }

        // Claude may emit execution noise after interrupt (e.g. request aborted /
        // rust-analyzer crash). Suppress noise entries within 5s of the last interrupt.
        const recentInterrupt =
          managed.lastInterruptAt &&
          Date.now() - managed.lastInterruptAt.getTime() < 5000
        if (recentInterrupt && isCancelledNoiseEntry(entry)) {
          if (isTurnCompletionEntry(entry)) {
            callbacks.onTurnCompleted()
          }
          continue
        }

        callbacks.onEntry(entry)

        if (isTurnCompletionEntry(entry)) {
          callbacks.onTurnCompleted()
        }
      } catch (entryError) {
        // Log and skip this entry — do not kill the stream consumer.
        // The stream is still readable; only the callback processing failed.
        logger.error(
          { issueId, executionId, entryError },
          'consume_stream_entry_processing_error',
        )
      }
    }
  } catch (error) {
    // Stream itself errored (reader.read() failed) — not recoverable
    callbacks.onStreamError(error)
  }
}

export async function consumeStderr(
  executionId: string,
  issueId: string,
  stream: ReadableStream<Uint8Array>,
  callbacks: Pick<StreamCallbacks, 'getManaged' | 'getTurnIndex' | 'onEntry'>,
): Promise<void> {
  const reader = stream.getReader()
  try {
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        if (IO_LOG_ENABLED) {
          logger.debug(
            { stream: 'stderr', line: clipForLog(line) },
            'claude_protocol_io',
          )
        }
        try {
          const managed = callbacks.getManaged()
          if (!managed) return
          managed.lastActivityAt = new Date()
          if (managed.stallProbeAt) managed.stallProbeAt = undefined
          pushStderrEntry(line, callbacks.getTurnIndex(), callbacks.onEntry)
        } catch (entryError) {
          logger.error(
            { issueId, executionId, entryError },
            'consume_stderr_entry_processing_error',
          )
        }
      }
    }

    if (buffer.trim()) {
      if (IO_LOG_ENABLED) {
        logger.debug(
          { stream: 'stderr', line: clipForLog(buffer) },
          'claude_protocol_io',
        )
      }
      const managed = callbacks.getManaged()
      if (managed) {
        pushStderrEntry(buffer, callbacks.getTurnIndex(), callbacks.onEntry)
      }
    }
  } catch {
    // Stderr stream closed or error — ignore
  } finally {
    reader.releaseLock()
  }
}

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { NormalizedLogEntry } from '@/engines/types'
import { ClaudeLogNormalizer } from '../claude/normalizer'

/**
 * Thin adapter that preserves the existing line-based `ClaudeLogNormalizer`
 * during the SDK migration. Each `SDKMessage` is re-serialized to JSON and
 * fed through the legacy normalizer.
 *
 * Step 5 of PLAN-003 will replace this with a typed normalizer that consumes
 * `SDKMessage` directly. Keeping the round-trip for now avoids duplicating
 * ~700 lines of tool-classification logic that is not SDK-specific.
 */
export class ClaudeSdkNormalizer {
  private readonly inner = new ClaudeLogNormalizer()

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.inner.parse(rawLine)
  }

  parseMessage(message: SDKMessage): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.inner.parse(JSON.stringify(message))
  }
}

export function stringifyMessage(message: SDKMessage): string {
  return `${JSON.stringify(message)}\n`
}

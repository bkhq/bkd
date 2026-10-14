import type { ChatMessage, IssueTurnSummary } from '@bkd/shared'

export interface ChatTurn {
  /** Position of the turn's user message in the message list; null while not loaded */
  index: number | null
  messageId: string
  userText: string
  replyText: string
  /** Visible log entries from this turn to the newest one (unloaded turns only) */
  entriesSince?: number
}

const MAX_TEXT_LENGTH = 300

/** Reduce Markdown to one line of plain text for a preview. */
function toPreviewText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{3,}|__|[`*~]/g, '')
    .replace(/^\s{0,3}(?:#{1,6}|[>\-+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

/** User rows that are not conversation turns; the server turn list skips the same ones. */
const NON_TURN_TYPES = new Set(['system', 'pending', 'done'])

function isTurnMessage(message: Extract<ChatMessage, { type: 'user' }>): boolean {
  const meta = message.entry.metadata
  return !meta?.subagent && !NON_TURN_TYPES.has(String(meta?.type ?? ''))
}

/** One turn per user message, previewed with the first agent reply after it. */
export function buildTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  messages.forEach((message, index) => {
    if (message.type === 'user') {
      if (!isTurnMessage(message)) return
      turns.push({
        index,
        messageId: message.entry.messageId ?? message.id,
        userText: toPreviewText(message.entry.content),
        replyText: '',
      })
      return
    }
    const current = turns.at(-1)
    if (message.type === 'assistant' && current && !current.replyText) {
      current.replyText = toPreviewText(message.entry.content)
    }
  })
  return turns
}

/**
 * Server turns older than the oldest loaded entry come first, unloaded; the
 * loaded turns follow, which also covers turns that arrived live.
 */
export function mergeTurns(
  serverTurns: IssueTurnSummary[] | undefined,
  loadedTurns: ChatTurn[],
  oldestLoadedId: string | undefined,
): ChatTurn[] {
  if (!serverTurns?.length || !oldestLoadedId) return loadedTurns
  const unloaded = serverTurns
    .filter(turn => turn.messageId < oldestLoadedId)
    .map(turn => ({
      index: null,
      messageId: turn.messageId,
      userText: toPreviewText(turn.userText),
      replyText: toPreviewText(turn.replyText),
      entriesSince: turn.entriesSince,
    }))
  return unloaded.length ? [...unloaded, ...loadedTurns] : loadedTurns
}

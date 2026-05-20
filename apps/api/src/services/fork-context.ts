/**
 * Build the title + prompt for an issue forked off a parent issue.
 * See PLAN-021 / FORK-002.
 */
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'

/** Max characters of parent transcript carried into the forked issue. */
const HISTORY_CHAR_BUDGET = 8000

export interface ForkContext {
  title: string
  prompt: string
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Compose the spawned issue's prompt from the parent's conversation plus the
 * user-supplied instruction.
 *
 * The carried context is the parent conversation up to (and including)
 * `fromLogId` — message-level fork. When `fromLogId` is omitted the whole
 * conversation is carried. Either way it is truncated to HISTORY_CHAR_BUDGET,
 * keeping the newest turns.
 */
export async function buildForkContext(opts: {
  parentIssueId: string
  instruction: string
  fromLogId?: string
}): Promise<ForkContext | null> {
  const [parent] = await db
    .select()
    .from(issuesTable)
    .where(and(eq(issuesTable.id, opts.parentIssueId), eq(issuesTable.isDeleted, 0)))
  if (!parent) return null

  const logs = await db
    .select()
    .from(logsTable)
    .where(and(eq(logsTable.issueId, opts.parentIssueId), eq(logsTable.visible, 1)))
    .orderBy(asc(logsTable.turnIndex), asc(logsTable.entryIndex))

  let messages = logs.filter(
    l => l.entryType === 'user-message' || l.entryType === 'assistant-message',
  )

  // Message-level fork: cut the transcript at the chosen log entry.
  if (opts.fromLogId) {
    const cutIdx = messages.findIndex(m => m.id === opts.fromLogId)
    if (cutIdx >= 0) messages = messages.slice(0, cutIdx + 1)
  }

  const parts: string[] = [`# Forked from issue: ${parent.title}`]

  if (messages.length > 0) {
    // Walk newest-first, accumulate until the char budget is hit, then
    // restore chronological order.
    const picked: string[] = []
    let used = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      const role = m.entryType === 'user-message' ? 'User' : 'Assistant'
      const block = `## ${role}\n${m.content}`
      if (used + block.length > HISTORY_CHAR_BUDGET && picked.length > 0) break
      picked.unshift(block)
      used += block.length
    }
    parts.push('## Parent conversation', truncate(picked.join('\n\n'), HISTORY_CHAR_BUDGET))
  }

  parts.push(`# Your task\n${opts.instruction.trim()}`)

  const title = truncate(`↳ ${parent.title}`, 80)
  return { title, prompt: parts.join('\n\n') }
}

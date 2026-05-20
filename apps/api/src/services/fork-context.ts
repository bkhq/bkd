/**
 * Build the title + prompt for an issue forked off a parent issue.
 * See PLAN-021.
 */
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'

/** Max characters of parent transcript carried when includeHistory is set. */
const HISTORY_CHAR_BUDGET = 8000

export interface ForkContext {
  title: string
  prompt: string
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Compose the spawned issue's prompt from the parent's context plus the
 * user-supplied instruction.
 *
 * - includeHistory=false: parent title + last user + last assistant message.
 * - includeHistory=true: parent transcript (user/assistant turns, newest
 *   turns kept) truncated to HISTORY_CHAR_BUDGET.
 */
export async function buildForkContext(opts: {
  parentIssueId: string
  instruction: string
  includeHistory: boolean
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

  const messages = logs.filter(
    l => l.entryType === 'user-message' || l.entryType === 'assistant-message',
  )

  const parts: string[] = [`# Forked from issue: ${parent.title}`]

  if (opts.includeHistory && messages.length > 0) {
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
  } else {
    const lastUser = [...messages].reverse().find(m => m.entryType === 'user-message')
    const lastAssistant = [...messages].reverse().find(m => m.entryType === 'assistant-message')
    if (lastUser) parts.push(`## Last instruction in parent\n${truncate(lastUser.content, 2000)}`)
    if (lastAssistant) {
      parts.push(`## Last assistant reply in parent\n${truncate(lastAssistant.content, 2000)}`)
    }
  }

  parts.push(`# Your task\n${opts.instruction.trim()}`)

  const title = truncate(`↳ ${parent.title}`, 80)
  return { title, prompt: parts.join('\n\n') }
}

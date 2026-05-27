import type { NormalizedLogEntry } from '@bkd/shared'
import { appEvents } from './index'

export function emitIssueUpdated(
  issueId: string,
  changes: Record<string, unknown>,
  title?: string,
  projectAlias?: string,
  source?: string,
): void {
  appEvents.emit('issue-updated', { issueId, changes, title, projectAlias, source })
}

export function emitIssueLogUpdated(issueId: string, entry: NormalizedLogEntry): void {
  appEvents.emit('log-updated', { issueId, entry })
}

export function emitIssueLogRemoved(issueId: string, messageIds: string[]): void {
  if (messageIds.length === 0) return
  appEvents.emit('log-removed', { issueId, messageIds })
}

export function emitIssueLogAdded(issueId: string, logId: string): void {
  appEvents.emit('log-added', { issueId, logId })
}

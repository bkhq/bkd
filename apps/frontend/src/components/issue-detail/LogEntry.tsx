import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Eye,
  FileEdit,
  FileText,
  FolderGit2,
  Globe,
  HelpCircle,
  ListTodo,
  Loader2,
  Monitor as MonitorIcon,
  Octagon,
  Search,
  Terminal,
  Timer,
  Wrench,
} from 'lucide-react'
import { Component, memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { useFilePreview } from '@/hooks/use-file-preview'
import { splitAssistantPreamble } from '@/lib/assistant-preamble'
import { getCommandPreview } from '@/lib/command-preview'
import { formatFileSize } from '@/lib/format'
import type { NormalizedLogEntry, ToolAction } from '@/types/kanban'
import { MarkdownContent } from './MarkdownContent'
import { MessageForkButton } from './MessageForkButton'

interface AttachmentMeta {
  id: string
  name: string
  mimeType: string
  size: number
}

function getToolIcon(action?: ToolAction) {
  if (!action) return { Icon: Wrench, color: 'text-muted-foreground' }
  switch (action.kind) {
    case 'file-read':
      return { Icon: FileText, color: 'text-blue-500' }
    case 'file-edit':
      return { Icon: FileEdit, color: 'text-amber-500' }
    case 'command-run':
      return { Icon: Terminal, color: 'text-green-500' }
    case 'search':
      return { Icon: Search, color: 'text-purple-500' }
    case 'web-fetch':
      return { Icon: Globe, color: 'text-cyan-500' }
    case 'agent':
      return { Icon: Bot, color: 'text-fuchsia-500' }
    case 'task-plan':
      return { Icon: ListTodo, color: 'text-indigo-500' }
    case 'user-question':
      return { Icon: HelpCircle, color: 'text-sky-500' }
    case 'tool': {
      switch (action.toolName) {
        case 'ScheduleWakeup':
          return { Icon: Timer, color: 'text-teal-500' }
        case 'Monitor':
          return { Icon: MonitorIcon, color: 'text-emerald-500' }
        case 'TaskOutput':
          return { Icon: Eye, color: 'text-blue-500' }
        case 'TaskStop':
          return { Icon: Octagon, color: 'text-red-500' }
        case 'EnterWorktree':
        case 'ExitWorktree':
          return { Icon: FolderGit2, color: 'text-orange-500' }
        default:
          return { Icon: Wrench, color: 'text-muted-foreground' }
      }
    }
    default:
      return { Icon: Wrench, color: 'text-muted-foreground' }
  }
}

function getToolLabel(
  action: ToolAction | undefined,
  toolName: string | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (!action) return ''
  switch (action.kind) {
    case 'file-read':
      return `${t('session.tool.fileRead')}: ${action.path}`
    case 'file-edit':
      if (toolName === 'Write') return `${t('session.tool.fileWrite')}: ${action.path}`
      return `${t('session.tool.fileEdit')}: ${action.path}`
    case 'command-run': {
      const summary = getCommandPreview(action.command, 90).summary
      return `${t('session.tool.commandRun')}: ${summary}`
    }
    case 'search':
      return `${t('session.tool.search')}: ${action.query}`
    case 'web-fetch':
      return `${t('session.tool.webFetch')}: ${action.url}`
    case 'agent': {
      const body = action.description || action.prompt || t('session.tool.agent')
      const subtype = action.subagentType ? `[${action.subagentType}] ` : ''
      const flags: string[] = []
      if (action.model) flags.push(action.model)
      if (action.runInBackground) flags.push('bg')
      if (action.isolation === 'worktree') flags.push('worktree')
      if (action.name) flags.push(`as ${action.name}`)
      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : ''
      return `${t('session.tool.agent')}: ${subtype}${body}${suffix}`
    }
    case 'task-plan': {
      const done = action.items.filter(i => i.status === 'completed').length
      return `${t('session.tool.taskPlan')} (${done}/${action.items.length})`
    }
    case 'user-question': {
      const first = action.questions[0]
      const q = first?.question ?? t('session.tool.userQuestion')
      const more = action.questions.length > 1 ? ` (+${action.questions.length - 1})` : ''
      return `${t('session.tool.userQuestion')}: ${q}${more}`
    }
    case 'tool': {
      switch (action.toolName) {
        case 'ScheduleWakeup': {
          const args = (action.arguments ?? {}) as Record<string, unknown>
          const delay = typeof args.delaySeconds === 'number' ? args.delaySeconds : undefined
          const reason = typeof args.reason === 'string' ? args.reason : undefined
          if (typeof delay === 'number') {
            return reason
              ? `${t('session.tool.scheduleWakeup')}: ${delay}s — ${reason}`
              : `${t('session.tool.scheduleWakeup')}: ${delay}s`
          }
          return reason ? `${t('session.tool.scheduleWakeup')}: ${reason}` : t('session.tool.scheduleWakeup')
        }
        case 'Monitor': {
          const args = (action.arguments ?? {}) as Record<string, unknown>
          const taskId = args.task_id ?? args.taskId ?? args.shell_id
          const cmd = args.command ?? args.until
          const target = taskId ?? cmd
          return target ? `${t('session.tool.monitor')}: ${String(target)}` : t('session.tool.monitor')
        }
        case 'TaskOutput': {
          const args = (action.arguments ?? {}) as Record<string, unknown>
          const taskId = args.task_id ?? args.taskId
          return taskId ? `${t('session.tool.taskOutput')}: ${String(taskId)}` : t('session.tool.taskOutput')
        }
        case 'TaskStop': {
          const args = (action.arguments ?? {}) as Record<string, unknown>
          const taskId = args.task_id ?? args.shell_id
          return taskId ? `${t('session.tool.taskStop')}: ${String(taskId)}` : t('session.tool.taskStop')
        }
        case 'EnterWorktree': {
          const args = (action.arguments ?? {}) as Record<string, unknown>
          const target = args.path ?? args.name
          return target
            ? `${t('session.tool.enterWorktree')}: ${String(target)}`
            : t('session.tool.enterWorktree')
        }
        case 'ExitWorktree': {
          const args = (action.arguments ?? {}) as Record<string, unknown>
          const act = typeof args.action === 'string' ? args.action : 'exit'
          return `${t('session.tool.exitWorktree')}: ${act}`
        }
        default:
          return action.toolName
      }
    }
    case 'other':
      return action.description
  }
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return ''
  try {
    const d = new Date(timestamp)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const remainS = Math.round(s % 60)
  return `${m}m${remainS}s`
}

function TaskPlanEntry({ entry }: { entry: NormalizedLogEntry }) {
  const items = (
    entry.metadata?.input as
    | {
      todos?: Array<{
        content: string
        status: string
        activeForm?: string
      }>
    } |
    undefined
  )?.todos
  if (!items || items.length === 0) return null

  const completedCount = items.filter(t => t.status === 'completed').length

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <ListTodo className="h-3 w-3 shrink-0 text-indigo-500" />
        <span className="font-medium">Task Plan</span>
        <span className="text-muted-foreground/50">
          (
          {completedCount}
          /
          {items.length}
          )
        </span>
      </div>
      <div className="ml-4 space-y-0.5">
        {items.map(item => (
          <div key={item.content} className="flex items-start gap-1.5 text-xs">
            {item.status === 'completed' ?
                (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
                ) :
              item.status === 'in_progress' ?
                  (
                    <Loader2 className="h-3 w-3 shrink-0 text-blue-500 animate-spin mt-0.5" />
                  ) :
                  (
                    <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40 mt-0.5" />
                  )}
            <span
              className={
                item.status === 'completed' ?
                  'text-muted-foreground/60 line-through' :
                  item.status === 'in_progress' ?
                    'text-blue-600 dark:text-blue-400' :
                    ''
              }
            >
              {item.status === 'in_progress' ? item.activeForm || item.content : item.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LogEntryImpl({
  entry,
  durationMs,
  inToolGroup = false,
}: {
  entry: NormalizedLogEntry
  durationMs?: number
  inToolGroup?: boolean
}) {
  const { t } = useTranslation()
  // On the cockpit `/review/:projectAlias/:issueId` route the param is the
  // project *alias*, not `projectId`. Fall back to it — the API resolves
  // projects by id or alias — so attachment URLs and the fork action don't
  // end up with an empty `/api/projects//...` segment.
  const params = useParams<{ projectId: string, projectAlias: string, issueId: string }>()
  const projectId = params.projectId || params.projectAlias || ''
  const issueId = params.issueId || ''

  // Role message rendering (execution context)
  if (entry.metadata?.role) {
    const role = entry.metadata.role as string
    const roleColors: Record<string, string> = {
      frontend: 'bg-blue-50/80 border-l-2 border-blue-400',
      backend: 'bg-green-50/80 border-l-2 border-green-400',
      host: 'bg-purple-50/80 border-l-2 border-purple-400',
    }

    return (
      <div className={`p-3 rounded-lg my-2 ${roleColors[role] || 'bg-gray-50/80 border-l-2 border-gray-400'}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-base">{(entry.metadata.roleAvatar as string) || '🤖'}</span>
          <span className="text-sm font-semibold text-foreground/90">{role}</span>
          {entry.metadata.isRunning === true && (
            <span className="text-xs text-muted-foreground animate-pulse ml-1">
              [正在执行...]
            </span>
          )}
        </div>
        <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
          {entry.content}
        </div>
      </div>
    )
  }

  // Role reply message rendering
  const isRoleMessage = entry.metadata?.isRoleReply === true
  if (isRoleMessage) {
    const roleName = (entry.metadata?.roleDisplayName as string) || (entry.metadata?.role as string) || t('role.unknown', 'Unknown')
    const roleColor = (entry.metadata?.roleColor as string) || '#3b82f6'
    const roleAvatar = (entry.metadata?.roleAvatar as string) || '🤖'
    return (
      <div className="group py-1.5 animate-message-enter">
        <div
          className="relative px-3 py-2 border-l-[3px] rounded-r-md bg-muted"
          style={{ borderLeftColor: roleColor }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{roleAvatar}</span>
            <span className="font-medium text-sm">{roleName}</span>
            <span className="text-xs bg-muted-foreground/10 px-2 py-0.5 rounded">
              {t('role.reply', 'Reply')}
            </span>
          </div>
          <div className="pl-7">
            {entry.entryType === 'assistant-message' ? (
              <AssistantMessage
                content={entry.content}
                timestamp={entry.timestamp}
                durationMs={durationMs}
                isStreaming={entry.metadata?.streaming === true}
                messageId={entry.messageId}
                projectId={projectId}
                issueId={issueId}
              />
            ) : (
              <div className="text-[15px] whitespace-pre-wrap break-words text-foreground leading-[1.7]">
                {entry.content}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  switch (entry.entryType) {
    case 'user-message': {
      const isPending = entry.metadata?.type === 'pending'
      const isDone = entry.metadata?.type === 'done'
      const messageAttachments = (entry.metadata?.attachments ?? []) as AttachmentMeta[]
      // Strip "--- Attached files ---" block from display (already shown as chips)
      const displayContent = entry.content.replace(/\n*--- Attached files ---\n(?:\[Attached file:.*\]\n?)*/g, '').trim()
      // Skip empty user messages (no text, no attachments, not pending/done)
      if (!displayContent && messageAttachments.length === 0 && !isPending && !isDone)
        return null
      // User messages need a clearly distinct surface against the
      // background-only assistant reply — earlier `bg-muted/40` was nearly
      // invisible on light themes and users couldn't tell the speakers
      // apart. We use the higher-contrast `bg-muted` (full opacity) plus a
      // primary-tinted left bar so the bubble reads as a quoted prompt.
      const barColor = isPending ?
        'border-amber-400/80 bg-amber-500/10' :
        isDone ?
          'border-emerald-400/80 bg-emerald-500/10' :
          'border-primary/70 bg-muted'
      // data-user-turn: stable DOM anchor for CurrentPromptHover. Skip
      // pending/done bubbles (they bypass the message list — see ChatBody)
      // so the hover only tracks landed turns.
      const turnIndex = entry.turnIndex
      const anchorTurn = !isPending && !isDone && typeof turnIndex === 'number' ?
        turnIndex :
        undefined
      return (
        <div
          className="group py-1.5 animate-message-enter"
          data-user-turn={anchorTurn}
        >
          <div className={`relative px-3 py-2 border-l-[3px] rounded-r-md ${barColor}`}>
            {entry.messageId
              ? (
                  <MessageForkButton
                    projectId={projectId}
                    issueId={issueId}
                    logId={entry.messageId}
                    className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                )
              : null}
            {displayContent ?
                (
                  <div className="text-[15px] whitespace-pre-wrap break-words text-foreground leading-[1.7]">
                    {displayContent}
                  </div>
                ) :
              null}
            {messageAttachments.length > 0 ?
                (
                  <div className={`flex flex-wrap gap-1.5${entry.content.trim() ? ' mt-2' : ''}`}>
                    {messageAttachments.map((att) => {
                      const isImage = att.mimeType.startsWith('image/')
                      const baseUrl = `/api/projects/${projectId}/issues/${issueId}/attachments/${att.id}`
                      return isImage ? (
                        <a
                          key={att.id}
                          href={`${baseUrl}?preview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded border border-border/40 overflow-hidden max-w-[200px] max-h-[150px] group/img"
                          title={`${att.name} (${formatFileSize(att.size)})`}
                        >
                          <img
                            src={`${baseUrl}?preview`}
                            alt={att.name}
                            className="object-cover w-full h-full transition-transform group-hover/img:scale-105"
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <a
                          key={att.id}
                          href={baseUrl}
                          download={att.name}
                          className="inline-flex items-center gap-1 rounded bg-muted/60 border border-border/40 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[120px]">{att.name}</span>
                          <span className="text-muted-foreground/50">{formatFileSize(att.size)}</span>
                        </a>
                      )
                    })}
                  </div>
                ) :
              null}
            {isPending || isDone ?
                (
                  <div className="flex items-center gap-2 mt-1">
                    {isPending ?
                        (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-500/70">
                            <Clock className="h-2.5 w-2.5" />
                            {t('chat.pendingMessage')}
                          </span>
                        ) :
                      null}
                    {isDone ?
                        (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500/70">
                            {t('chat.doneMessage')}
                          </span>
                        ) :
                      null}
                  </div>
                ) :
              null}
          </div>
        </div>
      )
    }

    case 'assistant-message':
      if (!entry.content.trim()) return null
      return (
        <AssistantMessage
          content={entry.content}
          timestamp={entry.timestamp}
          durationMs={durationMs}
          isStreaming={entry.metadata?.streaming === true}
          messageId={entry.messageId}
          projectId={projectId}
          issueId={issueId}
        />
      )

    case 'tool-use': {
      // Render structured task plan for TodoWrite
      const isTodoWrite =
        (entry.toolDetail?.toolName === 'TodoWrite' || entry.metadata?.toolName === 'TodoWrite') &&
        !entry.toolDetail?.isResult &&
        !entry.metadata?.isResult
      if (isTodoWrite) {
        return <TaskPlanEntry entry={entry} />
      }

      const { Icon, color } = getToolIcon(entry.toolAction)
      const toolName =
        typeof entry.metadata?.toolName === 'string' ? entry.metadata.toolName : undefined
      const label = getToolLabel(entry.toolAction, toolName, t)
      const isResult = entry.metadata?.isResult === true
      if (inToolGroup) {
        if (isResult) return null
        const isCommandTitle = entry.toolAction?.kind === 'command-run'
        const commandSummary =
          entry.toolAction?.kind === 'command-run' ?
            getCommandPreview(entry.toolAction.command, 90).summary :
            ''
        return (
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <Icon className={`h-3 w-3 shrink-0 ${color}`} />
            {isCommandTitle ?
                (
                  <div className="min-w-0 flex-1 truncate">
                    <span>
                      {t('session.tool.commandRun')}
                      :
                      {' '}
                    </span>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                      {commandSummary}
                    </code>
                  </div>
                ) :
                (
                  <span className="truncate font-mono">{label || entry.content}</span>
                )}
          </div>
        )
      }
      return (
        <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
          <Icon className={`h-3 w-3 shrink-0 ${color}`} />
          <span className="truncate font-mono">{label || entry.content}</span>
        </div>
      )
    }

    case 'system-message':
      // Show concise, actionable system events and suppress noisy internals.
      if (!entry.content.trim()) return null
      if (entry.metadata?.subtype === 'init') return null
      if (entry.metadata?.subtype === 'hook_response') return null
      if (entry.metadata?.subtype === 'hook_started') return null
      if (entry.metadata?.subtype === 'hook_completed') return null
      if (entry.metadata?.source === 'result') return null
      if (typeof entry.metadata?.duration === 'number') return null
      // Image metadata hints from CLI (e.g. "[Image: original 2400x312...]")
      if (entry.content.startsWith('[Image:')) return null
      // Command output (e.g. /context, /cost): collapsed by default
      if (entry.metadata?.subtype === 'command_output') {
        const firstLine = entry.content.split('\n')[0]?.trim() || 'Command output'
        return (
          <div className="my-1.5 animate-message-enter">
            <details className="bg-muted/40 border border-border/30 transition-all duration-200 open:bg-muted/20">
              <summary className="cursor-pointer list-none px-4 py-2 text-xs text-muted-foreground hover:bg-muted/20 transition-colors">
                <span className="font-mono">{firstLine}</span>
              </summary>
              <div className="px-4 pb-3 pt-1.5 border-t border-border/20">
                <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                  {entry.content}
                </pre>
              </div>
            </details>
          </div>
        )
      }
      // Compact boundary: show a visual divider
      if (entry.metadata?.subtype === 'compact_boundary') {
        return (
          <div className="flex items-center gap-3 py-2 my-1">
            <div className="flex-1 border-t border-dashed border-border/40" />
            <span className="text-[10px] text-muted-foreground/50 font-medium whitespace-nowrap">
              {t('session.contextCompacted')}
            </span>
            <div className="flex-1 border-t border-dashed border-border/40" />
          </div>
        )
      }
      return (
        <div className="py-0.5 text-[11px] text-muted-foreground/60 truncate">{entry.content}</div>
      )

    case 'error-message':
      return (
        <div className="flex gap-2 my-1.5 bg-destructive/[0.06] border border-destructive/20 px-3 py-2 animate-message-enter">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
          <code className="min-w-0 overflow-x-auto text-xs text-destructive/90 leading-relaxed whitespace-pre">
            {entry.content}
          </code>
        </div>
      )

    case 'thinking': {
      const preview = entry.content.length > 80 ? `${entry.content.slice(0, 80)}…` : entry.content
      return (
        <div className="my-1 animate-message-enter">
          <details className="rounded-lg bg-violet-500/[0.04] border border-violet-300/15 dark:border-violet-500/12 transition-all duration-200 open:bg-violet-500/[0.06]">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs text-violet-500/70 dark:text-violet-400/70 hover:bg-violet-500/[0.05] transition-colors rounded-lg open:rounded-b-none">
              <span className="italic">
                Thinking:
                {preview}
              </span>
            </summary>
            <div className="px-3 pb-2.5 pt-1.5 border-t border-violet-300/10 dark:border-violet-500/8">
              <pre className="text-xs text-violet-600/70 dark:text-violet-300/60 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                {entry.content}
              </pre>
            </div>
          </details>
        </div>
      )
    }

    case 'loading':
      return (
        <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary/50" />
          <span>{entry.content}</span>
        </div>
      )

    case 'token-usage':
      return null

    default:
      return null
  }
}

/**
 * LogEntry is rendered N times per turn and lives in a list whose parent
 * re-renders on every SSE chunk. Memoize on the relevant entry fields so
 * historical messages don't re-render when only the tail of the conversation
 * is updating (root cause 8: tab-freeze under heavy streams).
 */
export const LogEntry = memo(LogEntryImpl, (prev, next) => {
  if (prev.durationMs !== next.durationMs) return false
  if (prev.inToolGroup !== next.inToolGroup) return false
  const a = prev.entry
  const b = next.entry
  return (
    a === b
    || (a.messageId === b.messageId
      && a.entryType === b.entryType
      && a.content === b.content
      && a.metadata?.streaming === b.metadata?.streaming
      && a.metadata?.completed === b.metadata?.completed)
  )
})

// ── MarkdownErrorBoundary ──────────────────────────────────────────
// react-markdown is tolerant of incomplete input, but certain edge cases
// (e.g. malformed GFM tables, nested inline syntax at chunk boundaries)
// can throw during streaming. Without this boundary, the error propagates
// to the route-level ErrorBoundary, unmounting the entire chat, killing
// the SSE subscription, and silently truncating the response.
class MarkdownErrorBoundary extends Component<
  { fallbackContent: string, className?: string, children?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallbackContent: string, className?: string }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={`${this.props.className ?? ''} whitespace-pre-wrap break-words`}>
          {this.props.fallbackContent}
        </div>
      )
    }
    return this.props.children
  }
}

export function AssistantMessage({
  content,
  timestamp,
  durationMs,
  isStreaming = false,
  messageId,
  projectId = '',
  issueId = '',
}: {
  content: string
  timestamp?: string
  durationMs?: number
  isStreaming?: boolean
  messageId?: string
  projectId?: string
  issueId?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [preambleOpen, setPreambleOpen] = useState(false)
  // Wire inline file-path chips into the assistant reply. The hook returns
  // an empty path list outside an issue route, so the chip-aware branch in
  // MarkdownContent is a no-op for non-chat contexts.
  const { knownPaths, openPreview, hasPreview } = useFilePreview()

  // opencode/ACP engines emit a structured task-tracking preamble (Goal,
  // Constraints, Progress, ...) before the actual reply, all in one assistant
  // message. Users perceive this as "thinking content mixed into the reply".
  // Detect and split: render preamble as a collapsed block, reply normally.
  const { preamble, reply } = splitAssistantPreamble(content)
  // During streaming the preamble accumulates before the reply begins.
  // If we wait for reply, users see a blank bubble for seconds — show the
  // preamble text inline while `reply` is still being generated.
  const streamingPreview = isStreaming && preamble && !reply ? preamble : null

  const handleCopy = () => {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true)
        setTimeout(setCopied, 2000, false)
      })
      .catch(() => {})
  }

  return (
    <div className={`group py-1 ${isStreaming ? '' : 'animate-message-enter'}`}>
      <div className="relative min-w-0">
        {messageId
          ? (
              <MessageForkButton
                projectId={projectId}
                issueId={issueId}
                logId={messageId}
                className="absolute right-7 top-0 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            )
          : null}
        <button
          type="button"
          onClick={handleCopy}
          // Always faintly visible (opacity-30) so users discover that raw
          // markdown is copyable. The MarkdownContent rewrite changed the
          // assistant message from a Shiki-tokenized raw-source view to a
          // rendered HTML view, which made select-and-copy yield rendered
          // text without the `**`/`#` markers. The Copy button calls
          // `writeText(content)` with the original markdown source — we just
          // need to make sure users can find it.
          className="absolute right-0 top-0 rounded p-1 text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-muted/40 transition-all opacity-30 hover:opacity-100 z-10"
          title={t('session.copyMessage')}
        >
          {copied ?
              (
                <Check className="h-3 w-3 text-emerald-500" />
              ) :
              (
                <Copy className="h-3 w-3" />
              )}
        </button>

        {preamble
          ? (
              <div className="mb-2 border border-border/40 bg-muted/20 rounded-sm">
                <button
                  type="button"
                  onClick={() => setPreambleOpen(v => !v)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                >
                  <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${preambleOpen ? 'rotate-90' : ''}`} />
                  <ListTodo className="h-3 w-3 shrink-0 text-indigo-500/70" />
                  <span className="font-medium">{t('session.taskTrackingPreamble')}</span>
                  <span className="ml-auto text-[10px] opacity-50">{preambleOpen ? t('common.collapse') : t('common.expand')}</span>
                </button>
                {preambleOpen
                  ? (
                      <div className="px-3 pb-2 pt-1 border-t border-border/30">
                        <MarkdownContent
                          content={preamble}
                          className="text-[13px] leading-[1.65] text-muted-foreground"
                        />
                      </div>
                    )
                  : null}
              </div>
            )
          : null}

        {reply
          ? (
              <MarkdownErrorBoundary fallbackContent={reply} className="text-[15px] leading-[1.7] md:text-[14px] md:leading-[1.65]">
                <MarkdownContent
                  content={reply}
                  className="text-[15px] leading-[1.7] md:text-[14px] md:leading-[1.65]"
                  knownPaths={hasPreview ? knownPaths : undefined}
                  onPathClick={hasPreview ? openPreview : undefined}
                />
              </MarkdownErrorBoundary>
            )
          : streamingPreview
            ? (
                <MarkdownErrorBoundary fallbackContent={streamingPreview} className="text-[15px] leading-[1.7] md:text-[14px] md:leading-[1.65] animate-pulse">
                  <MarkdownContent
                    content={streamingPreview}
                    className="text-[15px] leading-[1.7] md:text-[14px] md:leading-[1.65] animate-pulse"
                  />
                </MarkdownErrorBoundary>
              )
            : null}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {timestamp ?
            (
              <span className="text-[10px] text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors duration-200">
                {formatTime(timestamp)}
              </span>
            ) :
          null}
        {durationMs != null ?
            (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                <Clock className="h-2.5 w-2.5" />
                {t('session.duration', { time: formatDuration(durationMs) })}
              </span>
            ) :
          null}
      </div>
    </div>
  )
}

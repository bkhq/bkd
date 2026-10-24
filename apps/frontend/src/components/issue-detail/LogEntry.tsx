import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Code,
  Copy,
  Eye,
  FileEdit,
  FileText,
  FolderGit2,
  Globe,
  HelpCircle,
  Image,
  ListTodo,
  Loader2,
  Monitor as MonitorIcon,
  Octagon,
  Search,
  Settings2,
  Terminal,
  Timer,
  Wrench,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import type { PreviewItem } from '@/components/FilePreviewModal'
import { FilePreviewModal } from '@/components/FilePreviewModal'
import { useIssue } from '@/hooks/use-kanban'
import { compactCommand } from '@/lib/command-preview'
import { formatDuration, formatFileSize } from '@/lib/format'
import { useViewModeStore } from '@/stores/view-mode-store'
import { cn } from 'cn'
import type { FollowUpSender, NormalizedLogEntry, ToolAction } from '@/types/kanban'
import { CHAT_BLOCK_BODY, CHAT_BLOCK_ROW, CHAT_BLOCK_SUMMARY, chatBlock } from './chat-block'
import { MarkdownContent } from './MarkdownContent'

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
      // Whole command on one line: the row's CSS truncation cuts it at the row width
      return `${t('session.tool.commandRun')}: ${compactCommand(action.command)}`
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

/** Colour of a message footer (time and actions): faint, brighter while the message is hovered. */
const MESSAGE_META = 'text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors duration-200'
/** Footer action: the footer colour, plus its own highlight under the pointer. */
// `!`: group-hover is the more specific selector and would win over the button's own hover
const MESSAGE_ACTION = cn('rounded-md p-1 hover:text-muted-foreground! hover:bg-muted/50', MESSAGE_META)

/** Icon-only copy action used in message footers; swaps to a check while `copied`. */
function CopyIconButton({
  label,
  copied,
  onClick,
}: {
  label: string
  copied: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={MESSAGE_ACTION}
      aria-label={copied ? t('session.copied') : label}
      title={label}
    >
      {copied ?
          (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) :
          (
            <Copy className="h-3.5 w-3.5" />
          )}
    </button>
  )
}

/** Write to the clipboard and run `onDone` for a 2s copied state. */
function copyToClipboard(value: string, onDone: () => void) {
  navigator.clipboard.writeText(value).then(onDone).catch(() => {})
}

/** Where a follow-up that is not the user's own came from: the sending issue, or BKD itself. */
function SenderLabel({ sender }: { sender: FollowUpSender }) {
  const { t } = useTranslation()
  if (sender.kind === 'system') {
    return (
      <span className="inline-flex items-center gap-1">
        <Settings2 className="h-3 w-3 shrink-0" />
        {t(sender.via === 'cron' ? 'chat.senderCron' : 'chat.senderMessage')}
      </span>
    )
  }
  return <AgentSenderLink projectId={sender.projectId} issueId={sender.issueId} />
}

function AgentSenderLink({ projectId, issueId }: { projectId: string, issueId: string }) {
  const { t } = useTranslation()
  const { data: issue } = useIssue(projectId, issueId)
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Bot className="h-3 w-3 shrink-0" />
      <span className="shrink-0">{t('chat.senderAgent')}</span>
      <Link to={`/projects/${projectId}/issues/${issueId}`} className="min-w-0 truncate font-medium text-foreground/80 hover:underline">
        {issue ? `#${issue.issueNumber} ${issue.title}` : issueId}
      </Link>
    </span>
  )
}

/** Agent follow-ups longer than this are folded to 8 lines (`line-clamp-8`) until expanded. */
const SENDER_FOLD_LINES = 8
const SENDER_FOLD_CHARS = 600

/**
 * Sent message card. Also used by ChatBody for queued messages, which pass the
 * ids explicitly (they may render outside the issue route) and an edit action.
 */
export function UserMessageEntry({
  entry,
  projectId: projectIdProp,
  issueId: issueIdProp,
  onEdit,
}: {
  entry: NormalizedLogEntry
  projectId?: string
  issueId?: string
  onEdit?: () => void
}) {
  const { t } = useTranslation()
  const params = useParams<{ projectId: string, issueId: string }>()
  const projectId = projectIdProp ?? params.projectId
  const issueId = issueIdProp ?? params.issueId
  const [preview, setPreview] = useState<PreviewItem | null>(null)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const sender = entry.metadata?.sender as FollowUpSender | undefined
  const isPending = entry.metadata?.type === 'pending'
  const isDone = entry.metadata?.type === 'done'
  const messageAttachments = (entry.metadata?.attachments ?? []) as AttachmentMeta[]
  // Strip "--- Attached files ---" block from display (already shown as chips)
  const displayContent = entry.content.replace(/\n*--- Attached files ---\n(?:\[Attached file:.*\]\n?)*/g, '').trim()
  // Skip empty user messages (no text, no attachments, not pending/done)
  if (!displayContent && messageAttachments.length === 0 && !isPending && !isDone)
    return null

  const tone = isPending ? 'pending' : isDone ? 'done' : sender?.kind === 'agent' ? 'agent' : 'user'
  const foldable = sender?.kind === 'agent' &&
    (displayContent.length > SENDER_FOLD_CHARS || displayContent.split('\n').length > SENDER_FOLD_LINES)

  // Optimistic attachments (created locally before the server assigns an id)
  // carry id === '' and aren't yet reachable; render them as static chips.
  const buildPreview = (att: AttachmentMeta): PreviewItem | null => {
    if (!projectId || !issueId || !att.id) return null
    return {
      kind: 'remote',
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
      url: `/api/projects/${projectId}/issues/${issueId}/attachments/${att.id}`,
    }
  }

  const handleCopy = () => {
    copyToClipboard(displayContent, () => {
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    })
  }

  return (
    // The user's sent messages sit on the right as a bubble sized to their text; queued
    // ones, agent and system follow-ups, and replies stay left
    <div
      data-slot="chat-block-row"
      data-sender={sender?.kind}
      className={cn('group flex flex-col animate-message-enter', isPending || sender ? 'items-start' : 'items-end', CHAT_BLOCK_ROW)}
    >
      <div
        data-slot="chat-block"
        className={cn(
          'min-w-0',
          sender?.kind === 'agent' ? 'w-full' : 'w-fit max-w-[85%]',
          chatBlock({ tone: sender?.kind === 'system' && !isPending ? 'neutral' : tone }),
          sender?.kind === 'system' ? CHAT_BLOCK_SUMMARY : CHAT_BLOCK_BODY,
        )}
      >
        {sender ?
            (
              <div className={cn('flex min-w-0 items-center text-[11px] text-muted-foreground', sender.kind === 'agent' && 'mb-1')}>
                <SenderLabel sender={sender} />
              </div>
            ) :
          null}
        {displayContent ?
            (
              <div
                data-slot="sender-body"
                className={cn(
                  'whitespace-pre-wrap break-words text-foreground',
                  sender?.kind === 'system' ? 'font-mono text-[12px] text-muted-foreground' : 'text-[14px] leading-[1.75]',
                  foldable && !expanded && 'line-clamp-8',
                )}
              >
                {displayContent}
              </div>
            ) :
          null}
        {foldable ?
            (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t(expanded ? 'chat.senderShowLess' : 'chat.senderShowAll')}
              </button>
            ) :
          null}
        {messageAttachments.length > 0 ?
            (
              <div className={`flex flex-wrap gap-1.5${displayContent ? ' mt-2' : ''}`}>
                {messageAttachments.map((att) => {
                  const previewItem = buildPreview(att)
                  const chipClass = 'inline-flex items-center gap-1 rounded bg-muted/60 border border-border/40 px-1.5 py-0.5 text-[11px] text-muted-foreground'
                  const inner = (
                    <>
                      {att.mimeType.startsWith('image/') ?
                          (
                            <Image className="h-3 w-3 shrink-0 text-blue-500" />
                          ) :
                          (
                            <FileText className="h-3 w-3 shrink-0" />
                          )}
                      <span title={att.name} className="truncate max-w-[120px]">{att.name}</span>
                      <span className="text-muted-foreground/50">{formatFileSize(att.size)}</span>
                    </>
                  )
                  if (!previewItem) {
                    return (
                      <span key={att.id} className={chipClass}>
                        {inner}
                      </span>
                    )
                  }
                  return (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => setPreview(previewItem)}
                      className={`${chipClass} cursor-pointer hover:bg-muted/80 transition-colors`}
                    >
                      {inner}
                    </button>
                  )
                })}
              </div>
            ) :
          null}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {entry.timestamp ?
            (
              <span className={cn('text-[10px]', MESSAGE_META)}>
                {formatTime(entry.timestamp)}
              </span>
            ) :
          null}
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
        <span className="ml-auto flex items-center gap-1">
          {displayContent ?
              (
                <span className="flex items-center">
                  <CopyIconButton label={t('session.copyMessage')} copied={copied} onClick={handleCopy} />
                </span>
              ) :
            null}
          {onEdit ?
              (
                <button
                  type="button"
                  onClick={onEdit}
                  className="shrink-0 rounded-md border border-border/40 bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t('common.edit')}
                </button>
              ) :
            null}
        </span>
      </div>
      {preview ?
          (
            <FilePreviewModal item={preview} onClose={() => setPreview(null)} />
          ) :
        null}
    </div>
  )
}

export function LogEntry({
  entry,
  durationMs,
  inToolGroup = false,
}: {
  entry: NormalizedLogEntry
  durationMs?: number
  inToolGroup?: boolean
}) {
  const { t } = useTranslation()

  switch (entry.entryType) {
    case 'user-message':
      return <UserMessageEntry entry={entry} />

    case 'assistant-message':
      if (!entry.content.trim()) return null
      return (
        <AssistantMessage
          content={entry.content}
          timestamp={entry.timestamp}
          durationMs={durationMs}
          isStreaming={!entry.messageId}
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
              compactCommand(entry.toolAction.command) :
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
                    <code title={commandSummary} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                      {commandSummary}
                    </code>
                  </div>
                ) :
                (
                  <span title={label || entry.content} className="truncate font-mono">{label || entry.content}</span>
                )}
          </div>
        )
      }
      return (
        <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
          <Icon className={`h-3 w-3 shrink-0 ${color}`} />
          <span title={label || entry.content} className="truncate font-mono">{label || entry.content}</span>
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
          <div data-slot="chat-block-row" className={cn('animate-message-enter', CHAT_BLOCK_ROW)}>
            <details data-slot="chat-block" className={cn(chatBlock({ tone: 'neutral' }), 'overflow-hidden transition-all duration-200 open:bg-muted/20')}>
              <summary className={cn('cursor-pointer list-none text-xs', CHAT_BLOCK_SUMMARY, 'text-muted-foreground hover:bg-muted/20 transition-colors')}>
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
        <div title={entry.content} className="py-0.5 text-[11px] text-muted-foreground/60 truncate">{entry.content}</div>
      )

    case 'error-message': {
      // Engine error kind (Codex `codexErrorInfo`): names the policy block or
      // stream failure behind an otherwise generic message.
      const errorKind = entry.metadata?.errorKind
      // The engine retries on its own, so the turn is still running.
      const retrying = entry.metadata?.willRetry === true
      return (
        <div data-slot="chat-block-row" className={cn('animate-message-enter', CHAT_BLOCK_ROW)}>
          <div
            data-slot="chat-block"
            className={cn('flex gap-2', chatBlock({ tone: retrying ? 'warning' : 'error' }), CHAT_BLOCK_BODY)}
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex flex-col gap-0.5">
              {typeof errorKind === 'string' && (
                <span className="text-xs font-medium">
                  {t(`session.errorKind.${errorKind}`, { defaultValue: errorKind })}
                </span>
              )}
              <code className="min-w-0 overflow-x-auto text-xs opacity-90 leading-relaxed whitespace-pre">
                {entry.content}
              </code>
            </div>
          </div>
        </div>
      )
    }

    case 'thinking': {
      // One line, cut by CSS at the row width rather than at a fixed length
      const preview = entry.content.replace(/\s+/g, ' ').trim()
      return (
        <div data-slot="chat-block-row" className={cn('animate-message-enter', CHAT_BLOCK_ROW)}>
          <details data-slot="chat-block" className={cn(chatBlock({ tone: 'thinking' }), 'overflow-hidden transition-all duration-200 open:bg-violet-500/[0.06]')}>
            <summary className={cn('cursor-pointer list-none text-xs', CHAT_BLOCK_SUMMARY, 'text-violet-500/70 dark:text-violet-400/70 hover:bg-violet-500/[0.06] transition-colors')}>
              <span title={preview} className="block truncate italic">
                Thinking:
                {preview}
              </span>
            </summary>
            <div className="px-3 pb-2 pt-1 border-t border-violet-300/15 dark:border-violet-500/10">
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

function AssistantMessage({
  content,
  timestamp,
  durationMs,
  isStreaming,
}: {
  content: string
  timestamp?: string
  durationMs?: number
  isStreaming: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Each message can flip between rendered Markdown and its source; until it does, it follows the setting.
  const renderSetting = useViewModeStore(s => s.renderMarkdown)
  const [renderOverride, setRenderOverride] = useState<boolean | null>(null)
  const renderMarkdown = renderOverride ?? renderSetting

  // Copies what is on screen: the rendered text, or the Markdown source in source view
  const copy = () => {
    const body = bodyRef.current
    // innerText keeps paragraph breaks from the rendered layout; jsdom lacks it, hence the fallback.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    const value = renderMarkdown ? (body?.innerText || body?.textContent || '') : content
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        setTimeout(setCopied, 2000, false)
      })
      .catch(() => {})
  }

  return (
    <div data-slot="chat-block-row" className={cn('group animate-message-enter', CHAT_BLOCK_ROW)}>
      <div ref={bodyRef} data-slot="chat-block" data-testid="assistant-message-body" className={cn('min-w-0', chatBlock({ tone: 'assistant' }), CHAT_BLOCK_BODY)}>
        <MarkdownContent content={content} className="text-[14px] leading-[1.75]" isStreaming={isStreaming} render={renderMarkdown} />
      </div>
      <div className="flex items-center gap-2 mt-1">
        {timestamp ?
            (
              <span className={cn('text-[10px]', MESSAGE_META)}>
                {formatTime(timestamp)}
              </span>
            ) :
          null}
        {durationMs != null ?
            (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/40">
                <Clock className="h-2.5 w-2.5" />
                {t('session.duration', { time: formatDuration(durationMs) })}
              </span>
            ) :
          null}
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setRenderOverride(!renderMarkdown)}
            className={MESSAGE_ACTION}
            aria-label={renderMarkdown ? t('session.viewSource') : t('session.viewMessage')}
            title={renderMarkdown ? t('session.viewSource') : t('session.viewMessage')}
            aria-pressed={!renderMarkdown}
          >
            {/* One icon; highlighted while the source is shown */}
            <Code className={cn('h-3.5 w-3.5', !renderMarkdown && 'text-primary')} />
          </button>
          <CopyIconButton label={t('common.copy')} copied={copied} onClick={copy} />
        </span>
      </div>
    </div>
  )
}

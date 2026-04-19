import type { ToolGroupChatMessage, ToolGroupItem } from '@bkd/shared'
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  FileEdit,
  FileText,
  FolderGit2,
  HelpCircle,
  ListTodo,
  Loader2,
  Monitor as MonitorIcon,
  Octagon,
  Search,
  Terminal,
  Timer,
  Users,
  Wrench,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCommandPreview } from '@/lib/command-preview'
import {
  CodeBlock,
  detectCodeLanguage,
  parseFileToolInput,
  ShikiPatchDiff,
  ShikiUnifiedDiff,
  ToolPanel,
} from './CodeRenderers'
import { MarkdownContent } from './MarkdownContent'

function getItemToolName(item: ToolGroupItem): string | undefined {
  return (
    item.action.toolDetail?.toolName
    ?? (typeof item.action.metadata?.toolName === 'string' ? item.action.metadata.toolName : undefined)
  )
}

interface AcpDiffArtifact {
  path: string
  oldText?: string
  newText: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ?
      (value as Record<string, unknown>) :
    null
}

function extractAcpDiffs(value: unknown): AcpDiffArtifact[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => extractAcpDiffs(item))
  }

  const record = asRecord(value)
  if (!record) return []

  if (
    record.type === 'diff'
    && typeof record.path === 'string'
    && typeof record.newText === 'string'
  ) {
    return [{
      path: record.path,
      oldText: typeof record.oldText === 'string' ? record.oldText : undefined,
      newText: record.newText,
    }]
  }

  return [
    ...extractAcpDiffs(record.content),
    ...extractAcpDiffs(record.output),
    ...extractAcpDiffs(record.rawOutput),
  ]
}

/** Compute +added / -removed line counts from old/new strings or patch. */
function diffStats(
  oldStr: string | undefined,
  newStr: string | undefined,
  patch?: string | undefined,
): { added: number, removed: number } | null {
  if (oldStr === undefined && newStr === undefined && patch === undefined) return null
  // Parse unified diff patch for line counts
  if (patch !== undefined && oldStr === undefined && newStr === undefined) {
    let added = 0
    let removed = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      else if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
    return (added > 0 || removed > 0) ? { added, removed } : null
  }
  const oldLines = oldStr ? oldStr.split('\n').length : 0
  const newLines = newStr ? newStr.split('\n').length : 0
  if (oldStr !== undefined && newStr !== undefined) {
    // Edit with both old and new — approximate diff
    return { added: newLines, removed: oldLines }
  }
  // Write (content only) — all additions
  if (newStr !== undefined) return { added: newLines, removed: 0 }
  return null
}

// ── Shared components ────────────────────────────────────

/** Check if an item result is an error */
function isItemError(item: ToolGroupItem): boolean {
  return item.result?.toolDetail?.raw?.isError === true
    || item.result?.entryType === 'error-message'
}

/** Tool type icon + label */
function ToolLabel({ label, icon: Icon }: { label: string, icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="flex items-center gap-1 shrink-0 text-[11px] text-muted-foreground/70">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

/** Badge component for file path */
function PathBadge({ path }: { path: string }) {
  return (
    <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono overflow-x-auto whitespace-nowrap scrollbar-none">{path}</code>
  )
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(setCopied, 1500, false)
  }, [path])
  const Icon = copied ? Check : Copy
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      <Icon className="h-3 w-3" />
    </button>
  )
}

/** Diff stats display: +N -M */
function DiffStatsLabel({ added, removed }: { added: number, removed: number }) {
  return (
    <span className="flex items-center gap-1 text-[11px] shrink-0">
      {added > 0
        ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              +
              {added}
            </span>
          )
        : null}
      {removed > 0
        ? (
            <span className="text-red-600 dark:text-red-400">
              -
              {removed}
            </span>
          )
        : null}
    </span>
  )
}

/** Extract Bash tool description from input metadata */
function getCommandDescription(item: ToolGroupItem): string | undefined {
  const input = item.action.metadata?.input
  if (input && typeof input === 'object' && 'description' in input) {
    const desc = (input as Record<string, unknown>).description
    return typeof desc === 'string' ? desc : undefined
  }
  return undefined
}

// ── Single tool item renderers ───────────────────────────

export function FileToolItem({ item }: { item: ToolGroupItem }) {
  const actionEntry = item.action
  const tool = actionEntry.toolAction
  const isEdit = tool?.kind === 'file-edit'
  const toolName
    = typeof actionEntry.metadata?.toolName === 'string' ? actionEntry.metadata.toolName : undefined
  const isWrite = toolName === 'Write'
  const filePath = tool && 'path' in tool ? tool.path : 'unknown'
  const codeLanguage = detectCodeLanguage(filePath)
  const parsed = parseFileToolInput(actionEntry.metadata?.input)
  const acpDiffs = [
    ...extractAcpDiffs(item.action.metadata?.content),
    ...extractAcpDiffs(item.result?.metadata?.content),
    ...extractAcpDiffs(item.result?.metadata?.output),
  ]
  const hasContent = parsed.content !== undefined
  const hasOldString = parsed.oldString !== undefined
  const hasNewString = parsed.newString !== undefined
  const hasPatch = parsed.patch !== undefined
  const hasUnifiedDiff = parsed.unifiedDiff !== undefined

  if (!isEdit) {
    const resultContent = item.result?.content
    const hasError = isItemError(item)
    const showResultText = resultContent && hasError

    return (
      <ToolPanel
        summary={(
          <div className="flex items-center gap-2 min-w-0">
            <ToolLabel label="Read" icon={FileText} />
            <PathBadge path={filePath} />
          </div>
        )}
        actions={<CopyPathButton path={filePath} />}
      >
        {showResultText
          ? (
              <div className="text-[11px] font-mono whitespace-pre-wrap text-red-600 dark:text-red-400">
                {resultContent}
              </div>
            )
          : null}
      </ToolPanel>
    )
  }

  // File edit / write
  const stats = diffStats(parsed.oldString, parsed.newString ?? parsed.content, parsed.patch)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={isWrite ? 'Write' : 'Edit'} icon={FileEdit} />
          <PathBadge path={filePath} />
          {stats ? <DiffStatsLabel added={stats.added} removed={stats.removed} /> : null}
        </div>
      )}
    >
      <div className="space-y-2">
        {hasContent
          ? <CodeBlock content={parsed.content!} language={codeLanguage} collapsible={false} />
          : null}

        {hasOldString
          ? (
              hasNewString
                ? (
                    <ShikiUnifiedDiff
                      original={parsed.oldString || ''}
                      modified={parsed.newString || ''}
                      filePath={filePath}
                    />
                  )
                : (
                    <CodeBlock
                      content={parsed.oldString || ''}
                      language={codeLanguage}
                      collapsible={false}
                    />
                  )
            )
          : null}

        {!hasOldString && hasNewString
          ? <CodeBlock content={parsed.newString || ''} language={codeLanguage} collapsible={false} />
          : null}

        {!hasOldString && !hasNewString && hasPatch
          ? <ShikiPatchDiff patch={parsed.patch!} filePath={filePath} />
          : null}

        {!hasPatch && hasUnifiedDiff && !hasContent && !hasOldString && !hasNewString
          ? <ShikiPatchDiff patch={parsed.unifiedDiff!} filePath={filePath} />
          : null}

        {acpDiffs.length > 0
          ? (
              <div className="space-y-2">
                {acpDiffs.map((diff, idx) => (
                  <ShikiUnifiedDiff
                    key={`${diff.path}-${idx}`}
                    original={diff.oldText || ''}
                    modified={diff.newText}
                    filePath={diff.path}
                  />
                ))}
              </div>
            )
          : null}

        {!hasContent && !hasOldString && !hasNewString && !hasPatch && !hasUnifiedDiff && acpDiffs.length === 0 && !parsed.hasOnlyFilePath
          ? <CodeBlock content={parsed.raw || '(empty)'} language="json" collapsible={false} />
          : null}
      </div>
    </ToolPanel>
  )
}

export function CommandToolItem({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const fullCommand
    = item.action.toolAction?.kind === 'command-run' ? item.action.toolAction.command : ''
  const preview = getCommandPreview(fullCommand, 80)
  const description = getCommandDescription(item)
  const hasError = isItemError(item)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label="Bash" icon={Terminal} />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {preview.summary}
          </code>
          {description
            ? (
                <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:inline">
                  {description}
                </span>
              )
            : null}
        </div>
      )}
    >
      <div className="space-y-2">
        {preview.isTruncated || fullCommand.includes('\n')
          ? (
              <div className="rounded-md border border-border/30 bg-muted/10 p-2">
                <div className="flex items-start gap-2">
                  <pre className="flex-1 text-[12px] font-mono whitespace-pre-wrap break-all leading-[1.5]">{fullCommand}</pre>
                  <button
                    type="button"
                    className="shrink-0 p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title={t('common.copy')}
                    onClick={() => navigator.clipboard.writeText(fullCommand)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          : null}
        {(() => {
          const resultContent = item.result?.content || item.action.content || '(empty)'
          return (
            <div className="relative group/result">
              <CodeBlock
                content={resultContent}
                collapsible={false}
                language={hasError ? 'text' : undefined}
              />
              <button
                type="button"
                className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover/result:opacity-100 hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground transition-all"
                title={t('common.copy')}
                onClick={() => navigator.clipboard.writeText(resultContent)}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })()}
      </div>
    </ToolPanel>
  )
}

/** Strip internal system lines from agent result content. */
function cleanAgentResult(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      if (line.startsWith('agentId:')) return false
      if (line.includes('do not mention to user')) return false
      if (line.startsWith('The agent is working in the background')) return false
      if (line.startsWith('You will be notified automatically')) return false
      if (line.startsWith('Async agent launched successfully')) return false
      return true
    })
    .join('\n')
    .trim()
}

export function AgentToolItem({ item }: { item: ToolGroupItem }) {
  const input = item.action.metadata?.input as {
    description?: string
    prompt?: string
    subagent_type?: string
    model?: string
    run_in_background?: boolean
    isolation?: string
    name?: string
  } | undefined
  const description = input?.description || input?.prompt || 'Agent'
  const subtype = input?.subagent_type
  const badges: string[] = []
  if (input?.model) badges.push(input.model)
  if (input?.run_in_background) badges.push('bg')
  if (input?.isolation === 'worktree') badges.push('worktree')
  if (input?.name) badges.push(`as ${input.name}`)
  const rawContent = item.result?.content || item.action.content || ''
  const resultContent = cleanAgentResult(rawContent)
  const hasError = isItemError(item)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={subtype ? `Agent: ${subtype}` : 'Agent'} icon={Users} />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {description}
          </code>
          {badges.length > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              {badges.map(b => (
                <span key={b} className="ml-1 rounded bg-muted/40 px-1 py-0.5">{b}</span>
              ))}
            </span>
          )}
        </div>
      )}
    >
      {resultContent
        ? (
            <div
              className={`overflow-y-auto max-h-96 ${hasError ? 'text-red-600 dark:text-red-400' : ''}`}
            >
              <MarkdownContent content={resultContent} className="text-[12px] leading-[1.7]" />
            </div>
          )
        : null}
    </ToolPanel>
  )
}

export function SearchToolItem({ item }: { item: ToolGroupItem }) {
  const tool = item.action.toolAction
  const query = tool && 'query' in tool ? tool.query : ''
  const toolName = getItemToolName(item)

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={toolName || 'Search'} icon={Search} />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
            {query}
          </code>
        </div>
      )}
    >
      <CodeBlock
        content={item.result?.content || item.action.content || '(empty)'}
        collapsible={false}
      />
    </ToolPanel>
  )
}

export function GenericToolItem({ item }: { item: ToolGroupItem }) {
  const toolName = getItemToolName(item)
  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={toolName || 'Tool'} icon={Wrench} />
          <span className="text-[11px] text-muted-foreground/60 truncate">
            {item.action.content}
          </span>
        </div>
      )}
    >
      <CodeBlock
        content={item.result?.content || item.action.content || '(empty)'}
        collapsible={false}
      />
    </ToolPanel>
  )
}

/** Read arguments from the persisted ToolAction first, then fall back to live metadata.input. */
function getToolArguments(item: ToolGroupItem): Record<string, unknown> {
  const action = item.action.toolAction
  if (action?.kind === 'tool' && action.arguments && typeof action.arguments === 'object') {
    return action.arguments as Record<string, unknown>
  }
  const input = item.action.metadata?.input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  return {}
}

interface ToolLabelSpec {
  icon: React.ComponentType<{ className?: string }>
  label: string
  detail?: string
}

function buildToolWithArgsLabel(
  toolName: string,
  args: Record<string, unknown>,
  t: (key: string) => string,
): ToolLabelSpec | null {
  switch (toolName) {
    case 'ScheduleWakeup': {
      const delay = typeof args.delaySeconds === 'number' ? args.delaySeconds : undefined
      const reason = typeof args.reason === 'string' ? args.reason : undefined
      const detail =
        typeof delay === 'number' ?
            (reason ? `${delay}s — ${reason}` : `${delay}s`) :
          reason
      return { icon: Timer, label: t('session.tool.scheduleWakeup'), detail }
    }
    case 'Monitor': {
      const taskId = args.task_id ?? args.taskId ?? args.shell_id
      const cmd = args.command ?? args.until
      const target = taskId ?? cmd
      return {
        icon: MonitorIcon,
        label: t('session.tool.monitor'),
        detail: target ? String(target) : undefined,
      }
    }
    case 'TaskOutput': {
      const taskId = args.task_id ?? args.taskId
      return {
        icon: Eye,
        label: t('session.tool.taskOutput'),
        detail: taskId ? String(taskId) : undefined,
      }
    }
    case 'TaskStop': {
      const taskId = args.task_id ?? args.shell_id
      return {
        icon: Octagon,
        label: t('session.tool.taskStop'),
        detail: taskId ? String(taskId) : undefined,
      }
    }
    case 'EnterWorktree': {
      const target = args.path ?? args.name
      return {
        icon: FolderGit2,
        label: t('session.tool.enterWorktree'),
        detail: target ? String(target) : undefined,
      }
    }
    case 'ExitWorktree': {
      const act = typeof args.action === 'string' ? args.action : 'exit'
      return { icon: FolderGit2, label: t('session.tool.exitWorktree'), detail: act }
    }
    default:
      return null
  }
}

export function ToolWithArgsItem({ item, spec }: { item: ToolGroupItem, spec: ToolLabelSpec }) {
  const hasError = isItemError(item)
  const resultContent = item.result?.content || item.action.content || ''
  const Icon = spec.icon
  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={spec.label} icon={Icon} />
          {spec.detail
            ? (
                <code className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono truncate">
                  {spec.detail}
                </code>
              )
            : null}
        </div>
      )}
    >
      {resultContent
        ? (
            <CodeBlock
              content={resultContent}
              collapsible={false}
              language={hasError ? 'text' : undefined}
            />
          )
        : null}
    </ToolPanel>
  )
}

export function TaskPlanToolItem({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const action = item.action.toolAction
  const items = action?.kind === 'task-plan' ? action.items : []
  const completed = items.filter(i => i.status === 'completed').length

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={t('session.tool.taskPlan')} icon={ListTodo} />
          <span className="text-[11px] text-muted-foreground/60 shrink-0">
            (
            {completed}
            /
            {items.length}
            )
          </span>
        </div>
      )}
    >
      <div className="space-y-0.5">
        {items.map((i, idx) => (
          <div key={`${i.content}-${idx}`} className="flex items-start gap-1.5 text-xs">
            {i.status === 'completed'
              ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500 mt-0.5" />
              : i.status === 'in_progress'
                ? <Loader2 className="h-3 w-3 shrink-0 text-blue-500 animate-spin mt-0.5" />
                : <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40 mt-0.5" />}
            <span
              className={
                i.status === 'completed'
                  ? 'text-muted-foreground/60 line-through'
                  : i.status === 'in_progress'
                    ? 'text-blue-600 dark:text-blue-400'
                    : ''
              }
            >
              {i.status === 'in_progress' ? i.activeForm || i.content : i.content}
            </span>
          </div>
        ))}
      </div>
    </ToolPanel>
  )
}

export function UserQuestionToolItem({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const action = item.action.toolAction
  const questions = action?.kind === 'user-question' ? action.questions : []
  const recommendedIndex = action?.kind === 'user-question' ? action.recommendedIndex : undefined
  const first = questions[0]
  const summaryText = first?.question ?? t('session.tool.userQuestion')
  const moreCount = questions.length > 1 ? questions.length - 1 : 0

  return (
    <ToolPanel
      collapsible
      summary={(
        <div className="flex items-center gap-2 min-w-0">
          <ToolLabel label={t('session.tool.userQuestion')} icon={HelpCircle} />
          <span className="text-[11px] text-muted-foreground/80 truncate">
            {summaryText}
            {moreCount > 0 ? ` (+${moreCount})` : ''}
          </span>
        </div>
      )}
    >
      <div className="space-y-3">
        {questions.map((q, qIdx) => (
          <div key={`${q.question}-${qIdx}`} className="space-y-1">
            <div className="text-[12px] font-medium text-foreground/90">{q.question}</div>
            {q.options && q.options.length > 0
              ? (
                  <ul className="ml-3 space-y-0.5">
                    {q.options.map((opt, oIdx) => {
                      const isRecommended =
                        opt.recommended === true || (qIdx === 0 && oIdx === recommendedIndex)
                      return (
                        <li key={`${opt.label}-${oIdx}`} className="flex items-start gap-1.5 text-[11px]">
                          <span className={isRecommended ? 'text-emerald-500 shrink-0' : 'text-muted-foreground/60 shrink-0'}>
                            {isRecommended ? '★' : '•'}
                          </span>
                          <span className={isRecommended ? 'text-foreground' : 'text-muted-foreground'}>
                            {opt.label}
                            {opt.description ? (
                              <span className="text-muted-foreground/60">
                                {' '}
                                —
                                {opt.description}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )
              : null}
          </div>
        ))}
      </div>
    </ToolPanel>
  )
}

// ── ToolGroupMessage — collapsible group of tool calls ───

function getGroupSummaryLabel(
  stats: Record<string, number>,
  count: number,
  t: (key: string) => string,
): string {
  const parts: string[] = []
  if (stats['file-read']) parts.push(`${stats['file-read']} ${t('session.tool.fileRead')}`)
  if (stats['file-edit']) parts.push(`${stats['file-edit']} ${t('session.tool.fileEdit')}`)
  if (stats['command-run']) parts.push(`${stats['command-run']} ${t('session.tool.commandRun')}`)
  if (stats.search) parts.push(`${stats.search} ${t('session.tool.search')}`)
  if (stats['web-fetch']) parts.push(`${stats['web-fetch']} ${t('session.tool.webFetch')}`)
  const otherCount = count - Object.values(stats).reduce((a, b) => a + b, 0) + (stats.other ?? 0)
  if (otherCount > 0) parts.push(`${otherCount} other`)
  return parts.length > 0 ? parts.join(', ') : `${count} tool calls`
}

function ToolItemRenderer({ item }: { item: ToolGroupItem }) {
  const { t } = useTranslation()
  const kind = item.action.toolAction?.kind
  const toolName = getItemToolName(item)
  if (toolName === 'Agent' || kind === 'agent') return <AgentToolItem item={item} />
  if (kind === 'file-edit' || kind === 'file-read') return <FileToolItem item={item} />
  if (kind === 'command-run') return <CommandToolItem item={item} />
  if (kind === 'search') return <SearchToolItem item={item} />
  if (kind === 'task-plan') return <TaskPlanToolItem item={item} />
  if (kind === 'user-question') return <UserQuestionToolItem item={item} />
  if (kind === 'tool' && toolName) {
    const spec = buildToolWithArgsLabel(toolName, getToolArguments(item), t)
    if (spec) return <ToolWithArgsItem item={item} spec={spec} />
  }
  return <GenericToolItem item={item} />
}

const DEFAULT_VISIBLE_COUNT = 3

const MemoizedToolItemRenderer = memo(ToolItemRenderer)

export function ToolGroupMessage({ message }: { message: ToolGroupChatMessage }) {
  const { t } = useTranslation()
  const { items, stats, count, description, isActive } = message
  const statsLabel = getGroupSummaryLabel(stats, count, t)
  const bodyId = `tg-body-${message.id}`

  // isOpen: controls body visibility after streaming ends (header click)
  // expanded: controls item truncation (show more/less) within the body
  const [isOpen, setIsOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)

  // isActive is set by useChatMessages — true when this group is the trailing
  // tool group (no subsequent assistant/user message has flushed it yet).
  // It stays true until the next conversation message arrives, so it won't
  // flicker between tool action/result pairs.
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Track whether this group was ever active (streaming).
  // Historical groups skip the auto-collapse on mount.
  const wasEverActiveRef = useRef(!!isActive)
  if (isActive) wasEverActiveRef.current = true

  // When the group is no longer active (assistant message arrived),
  // reset expanded so items truncate back to DEFAULT_VISIBLE_COUNT.
  useEffect(() => {
    if (!isActive && wasEverActiveRef.current) {
      setExpanded(false)
    }
  }, [isActive])

  // During streaming: always show body (auto-expand)
  // After streaming: user controls via isOpen
  const bodyVisible = isActive || isOpen

  const hasMore = items.length > DEFAULT_VISIBLE_COUNT
  // No truncation while group is active (show all items in real-time)
  const shouldTruncate = bodyVisible && hasMore && !expanded && !isActive
  const visibleItems = shouldTruncate ? items.slice(0, DEFAULT_VISIBLE_COUNT) : items
  const truncatedCount = items.length - DEFAULT_VISIBLE_COUNT

  const handleHeaderClick = useCallback(() => {
    // During streaming, body is auto-expanded — header click is a no-op
    if (!isActiveRef.current) {
      setIsOpen(v => !v)
    }
  }, [])

  return (
    <div className="py-1.5 animate-message-enter">
      <div className="border border-border/60 bg-card/50">
        <button
          type="button"
          onClick={handleHeaderClick}
          aria-expanded={bodyVisible}
          aria-controls={bodyId}
          aria-disabled={isActive || undefined}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground cursor-pointer select-none bg-muted/60"
        >
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${bodyVisible ? 'rotate-90' : ''}`} />
          <span className="truncate">{description || statsLabel}</span>
          {description
            ? (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
                  {statsLabel}
                </span>
              )
            : null}
        </button>
        {bodyVisible
          ? (
              <div id={bodyId} role="region" className="divide-y divide-border/50">
                {visibleItems.map((item, idx) => (
                  <MemoizedToolItemRenderer key={item.action.messageId ?? item.action.toolDetail?.toolCallId ?? `ti-${idx}`} item={item} />
                ))}
                {shouldTruncate
                  ? (
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/40 transition-colors text-center cursor-pointer"
                        onClick={() => setExpanded(true)}
                      >
                        {t('session.tool.showMore', { count: truncatedCount })}
                      </button>
                    )
                  : null}
                {hasMore && expanded && !isActive
                  ? (
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/40 transition-colors text-center cursor-pointer"
                        onClick={() => setExpanded(false)}
                      >
                        {t('session.tool.showLess')}
                      </button>
                    )
                  : null}
              </div>
            )
          : null}
      </div>
    </div>
  )
}

// @bkd/shared — Types shared between @bkd/api and @bkd/frontend
// Re-exported from packages/shared for cross-workspace consumption.

export interface Project {
  id: string
  alias: string
  name: string
  description?: string
  directory?: string
  repositoryUrl?: string
  systemPrompt?: string
  envVars?: Record<string, string>
  /** Per-project default engine; undefined = inherit global default */
  defaultEngine?: EngineType
  /** Per-project default model; undefined = inherit global default */
  defaultModel?: string
  sortOrder: string
  isArchived: boolean
  isGitRepo: boolean
  createdAt: string
  updatedAt: string
}

export type EngineType = 'claude-code' | 'codex'

export interface PluginInfo { name: string, path: string }

export interface CategorizedCommands {
  commands: string[]
  agents: string[]
  plugins: PluginInfo[]
}
export type PermissionMode = 'auto' | 'supervised' | 'plan'
export type BusyAction = 'queue' | 'cancel'
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Issue {
  id: string
  projectId: string
  statusId: string
  issueNumber: number
  title: string
  tags: string[] | null
  sortOrder: string
  useWorktree: boolean
  isPinned: boolean
  keepAlive: boolean
  engineType: EngineType | null
  /** Virtual engine id when this issue runs a virtual engine; null otherwise. */
  engineProfileId: string | null
  sessionStatus: SessionStatus | null
  prompt: string | null
  externalSessionId: string | null
  model: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: string
  /** Live context usage (claude-code only); 0 when unknown */
  contextTokens: number
  contextWindow: number
  statusUpdatedAt: string
  createdAt: string
  updatedAt: string
}

export type ApiResponse<T> = { success: true, data: T } | { success: false, error: string }

export type LogEntryType =
  | 'user-message' |
  'assistant-message' |
  'tool-use' |
  'system-message' |
  'error-message' |
  'thinking' |
  'loading' |
  'token-usage'
export type CommandCategory = 'read' | 'search' | 'edit' | 'fetch' | 'other'

export interface FileChange {
  oldText: string
  newText: string
}

// ── Local engine sessions (recorded outside BKD) ──────────

export interface LocalSession {
  engine: 'claude-code' | 'codex'
  sessionId: string
  /** Working directory the session ran in — decides whether resume will work */
  cwd: string
  title: string
  startedAt?: string
  lastActiveAt: string
  sizeBytes: number
  gitBranch?: string
  cliVersion?: string
  model?: string
  /** Set when the session is already bound to a BKD issue */
  managedByIssueId?: string
  managedByProjectId?: string
  /** Project whose directory equals the session cwd, when one exists */
  matchedProjectId?: string
}

export interface LocalSessionListResponse {
  sessions: LocalSession[]
  total: number
  hasMore: boolean
}

export interface LocalSessionPreview {
  session: LocalSession
  entries: NormalizedLogEntry[]
  totalEntries: number
}

export interface ImportSessionRequest {
  engine: 'claude-code' | 'codex'
  sessionId: string
  title?: string
  statusId?: 'todo' | 'working' | 'review' | 'done'
  /** false imports only the session link, leaving the chat empty */
  importLogs?: boolean
}

export interface ImportSessionResult {
  issue: Issue
  importedEntries: number
  droppedEntries: number
  /** false when the session ran outside the project directory */
  cwdMatches: boolean
}

/** Attribution for a turn forwarded from a subagent (Agent/Task tool). */
export interface SubagentAttribution {
  /** `parent_tool_use_id` — the tool call that dispatched the subagent */
  toolCallId: string
  /** `subagent_type`, e.g. `general-purpose` */
  type?: string
  /** Task description given at dispatch */
  description?: string
}

export interface TaskPlanItem {
  content: string
  status: string
  activeForm?: string
}

export interface UserQuestionOption {
  label: string
  description?: string
  recommended?: boolean
}

export interface UserQuestionItem {
  question: string
  options?: UserQuestionOption[]
  multiSelect?: boolean
}

export type ToolAction =
  | { kind: 'file-read', path: string } |
  { kind: 'file-edit', path: string, changes?: FileChange[] } |
  {
    kind: 'command-run'
    command: string
    result?: string
    category?: CommandCategory
  } |
  { kind: 'search', query: string } |
  { kind: 'web-fetch', url: string } |
  {
    kind: 'agent'
    subagentType?: string
    description?: string
    prompt?: string
    model?: string
    runInBackground?: boolean
    isolation?: string
    name?: string
  } |
  { kind: 'task-plan', items: TaskPlanItem[] } |
  {
    kind: 'user-question'
    questions: UserQuestionItem[]
    recommendedIndex?: number
  } |
  { kind: 'tool', toolName: string, arguments?: unknown, result?: unknown } |
  { kind: 'other', description: string }

export interface ToolDetail {
  kind: string
  toolName: string
  toolCallId?: string
  isResult: boolean
  raw?: Record<string, unknown>
}

export interface NormalizedLogEntry {
  messageId?: string
  replyToMessageId?: string
  timestamp?: string
  turnIndex?: number
  entryType: LogEntryType
  content: string
  metadata?: Record<string, unknown>
  toolAction?: ToolAction
  toolDetail?: ToolDetail
}

// ── ChatMessage (rebuilt from NormalizedLogEntry[]) ───────

export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string
  size: number
}

export interface ToolGroupItem {
  /** The tool invocation entry (isResult: false) */
  action: NormalizedLogEntry
  /** The matching tool result entry, if available */
  result: NormalizedLogEntry | null
  /** Activity forwarded from the subagent this tool call dispatched */
  subagent?: SubagentThread
}

/** One step inside a subagent thread, in emission order. */
export type SubagentItem =
  | { kind: 'tool', item: ToolGroupItem }
  | { kind: 'text', entry: NormalizedLogEntry }
  | { kind: 'thinking', entry: NormalizedLogEntry }

/**
 * Everything a single subagent did, reconstructed from turns tagged with
 * `metadata.subagent` plus the `task_*` lifecycle events for the same tool call.
 */
export interface SubagentThread {
  /** The Agent/Task tool call that dispatched this subagent */
  toolCallId: string
  type?: string
  description?: string
  status?: 'running' | 'completed' | 'failed'
  /** Tool the subagent was last seen running (from task_progress) */
  lastToolName?: string
  toolUses?: number
  totalTokens?: number
  durationMs?: number
  /** Result summary reported by task_notification */
  summary?: string
  items: SubagentItem[]
}

export interface UserChatMessage {
  type: 'user'
  id: string
  entry: NormalizedLogEntry
  attachments: AttachmentMeta[]
  status: 'normal' | 'pending' | 'done' | 'command'
  commandOutput?: NormalizedLogEntry
}

export interface AssistantChatMessage {
  type: 'assistant'
  id: string
  entry: NormalizedLogEntry
  durationMs?: number
}

export interface ToolGroupChatMessage {
  type: 'tool-group'
  id: string
  /** Paired tool call items in this group */
  items: ToolGroupItem[]
  /** Count by tool kind: { 'file-read': 3, 'file-edit': 2, ... } */
  stats: Record<string, number>
  /** Total operations (including hidden) */
  count: number
  /** Number of operations hidden by write filter rules */
  hiddenCount: number
  /** Thinking/description text absorbed from the preceding thinking entry */
  description?: string
  /** True when this group is the last in the message list and may still receive new tool calls */
  isActive?: boolean
}

export interface TaskPlanChatMessage {
  type: 'task-plan'
  id: string
  entry: NormalizedLogEntry
  todos: Array<{ content: string, status: string, activeForm?: string }>
  completedCount: number
}

export interface ThinkingChatMessage {
  type: 'thinking'
  id: string
  entry: NormalizedLogEntry
}

export interface SystemChatMessage {
  type: 'system'
  id: string
  entry: NormalizedLogEntry
  subtype: string
}

export interface ErrorChatMessage {
  type: 'error'
  id: string
  entry: NormalizedLogEntry
}

export type ChatMessage =
  | UserChatMessage |
  AssistantChatMessage |
  ToolGroupChatMessage |
  TaskPlanChatMessage |
  ThinkingChatMessage |
  SystemChatMessage |
  ErrorChatMessage

// ── Tool Progress (lightweight real-time SSE event) ──────

export interface ToolProgressEntry {
  toolName: string
  toolKind: string
  path?: string
  command?: string
}

export interface ToolProgressEvent {
  issueId: string
  executionId: string
  /** Accumulated tool calls in the current group so far */
  items: ToolProgressEntry[]
  stats: Record<string, number>
  count: number
}

export interface ToolGroupEvent {
  issueId: string
  executionId: string
  /** The completed tool group as a ChatMessage */
  message: ToolGroupChatMessage
}

export interface ExecuteIssueRequest {
  engineType: EngineType
  prompt: string
  model?: string
  permissionMode?: PermissionMode
}

export interface ExecuteIssueResponse {
  executionId?: string
  issueId: string
  messageId?: string
  queued?: boolean
}

export interface IssueLogsResponse {
  issue: Issue
  logs: NormalizedLogEntry[]
  hasMore: boolean
  nextCursor: string | null
}

export interface IssueChangedFile {
  path: string
  status: string
  type: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'
  staged: boolean
  unstaged: boolean
  additions?: number
  deletions?: number
  /** true when the file exceeds the large-file threshold (20 MB) */
  oversized?: boolean
  /** human-readable file size (only set when oversized) */
  sizeDisplay?: string
}

export interface IssueChangesResponse {
  /** Absent when the project has no directory configured. */
  root?: string
  gitRepo: boolean
  files: IssueChangedFile[]
  additions: number
  deletions: number
  /** true when git status timed out (e.g. very large repo or slow disk) */
  timedOut?: boolean
}

export interface IssueFilePatchResponse {
  path: string
  patch: string
  oldText?: string
  newText?: string
  truncated: boolean
  type?: IssueChangedFile['type']
  status?: string
  /** true when the file exceeds the large-file threshold */
  oversized?: boolean
  /** human-readable file size (only set when oversized) */
  sizeDisplay?: string
}

export interface EngineAvailability {
  engineType: EngineType
  installed: boolean
  executable?: boolean
  version?: string
  binaryPath?: string
  authStatus: 'authenticated' | 'unauthenticated' | 'unknown'
  error?: string
}

export interface EngineModel {
  id: string
  name: string
  isDefault?: boolean
}

export interface EngineDiscoveryResult {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
}

export interface EngineProfile {
  engineType: EngineType
  name: string
  baseCommand: string
  protocol: string
  capabilities: string[]
  defaultModel?: string
  permissionPolicy: string
}

/**
 * A virtual engine reuses a real executor (its `baseEngine`) but injects a
 * preset set of environment variables, so e.g. Claude Code can be pointed at a
 * third-party Anthropic-compatible backend. Persisted in app settings.
 */
export interface VirtualEngine {
  id: string
  name: string
  baseEngine: EngineType
  /** Provider base URL → injected as ANTHROPIC_BASE_URL and used for model discovery. */
  baseUrl?: string
  /** Provider token → injected as ANTHROPIC_AUTH_TOKEN and used for model discovery. */
  authToken?: string
  /** Optional fallback default model when discovery is unavailable. */
  model?: string
  /** Advanced extra env vars merged into the engine process. */
  envVars: Record<string, string>
}

export interface EngineSettings {
  defaultEngine: string | null
  engines: Record<string, { defaultModel?: string, hiddenModels?: string[] }>
}

export interface ProbeResult {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
  duration: number
}

/** A single rate-limit window in the Claude subscription usage panel. */
export interface ClaudeUsageWindow {
  /** Percentage of the window consumed (0–100). */
  usedPercentage: number
  /** ISO timestamp when the window resets, if known. */
  resetsAt: string | null
}

/** A model-scoped weekly rate-limit window (e.g. Fable). */
export interface ClaudeUsageModelWindow extends ClaudeUsageWindow {
  /** Upstream model display name, e.g. "Fable". */
  model: string
}

/**
 * Claude subscription rate-limit utilization (the TUI `/usage` panel).
 * `available: false` carries a reason for the unavailable state.
 */
export interface ClaudeUsage {
  available: boolean
  reason?: 'no_credentials' | 'api_key_mode' | 'token_expired' | 'upstream_error'
  /** 5-hour session window (may be absent even when available). */
  fiveHour?: ClaudeUsageWindow | null
  /** 7-day window. */
  sevenDay?: ClaudeUsageWindow | null
  /** Model-scoped weekly windows from the upstream `limits` array. */
  modelWindows?: ClaudeUsageModelWindow[]
}

// ── Event Bus ────────────────────────────────────────────

export interface ChangesSummary {
  issueId: string
  fileCount: number
  additions: number
  deletions: number
}

/** SSE wire format — what the frontend receives via EventSource. */
export interface SSEEventMap {
  'log': { issueId: string, entry: NormalizedLogEntry }
  'log-updated': { issueId: string, entry: NormalizedLogEntry }
  'log-removed': { issueId: string, messageIds: string[] }
  'tool-progress': ToolProgressEvent
  'tool-group': ToolGroupEvent
  'state': { issueId: string, executionId: string, state: string }
  'done': { issueId: string, finalStatus: string }
  'issue-updated': { issueId: string, changes: Record<string, unknown> }
  'changes-summary': ChangesSummary
  'context-usage': ContextUsageEvent
  'heartbeat': { ts: string }
}

export interface ContextUsageEvent {
  issueId: string
  contextTokens: number
  contextWindow: number
}

/** Internal bus format — superset of SSEEventMap, carries engine context. */
export interface AppEventMap {
  'log': {
    issueId: string
    executionId: string
    entry: NormalizedLogEntry
    streaming: boolean
  }
  'log-updated': { issueId: string, entry: NormalizedLogEntry }
  'log-removed': { issueId: string, messageIds: string[] }
  'state': { issueId: string, executionId: string, state: string }
  'done': { issueId: string, executionId: string, finalStatus: string }
  'issue-updated': { issueId: string, changes: Record<string, unknown> }
  'changes-summary': ChangesSummary
  'context-usage': { issueId: string, contextTokens: number, contextWindow: number }
  'heartbeat': { ts: string }
}

// ── File Browser ──────────────────────────────────────────

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
}

export interface DirectoryListing {
  path: string
  type: 'directory'
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  type: 'file'
  content: string
  size: number
  isTruncated: boolean
  isBinary: boolean
}

export type FileListingResult = DirectoryListing | FileContent

// ── Process Manager ─────────────────────────────────────

export interface ProcessInfo {
  executionId: string
  issueId: string
  issueTitle: string
  issueNumber: number
  projectId: string
  projectAlias: string
  projectName: string
  engineType: string
  processState: string
  model: string | null
  startedAt: string
  turnInFlight: boolean
  spawnCommand: string | null
  lastIdleAt: string | null
  pid: number | null
}

export interface ProjectProcessesResponse {
  processes: ProcessInfo[]
}

// ── Webhooks ─────────────────────────────────────────────

export type WebhookEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'issue.status.todo'
  | 'issue.status.working'
  | 'issue.status.review'
  | 'issue.status.done'
  | 'session.started'
  | 'session.completed'
  | 'session.failed'
  | 'issue.status_changed' // legacy — kept for backwards compat with existing DB records

/** Event types grouped by category for UI display. */
export const WEBHOOK_EVENT_GROUPS: { category: string, events: WebhookEventType[] }[] = [
  {
    category: 'issue',
    events: ['issue.created', 'issue.updated', 'issue.deleted'],
  },
  {
    category: 'status',
    events: ['issue.status.todo', 'issue.status.working', 'issue.status.review', 'issue.status.done'],
  },
  {
    category: 'session',
    events: ['session.started', 'session.completed', 'session.failed'],
  },
]

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = WEBHOOK_EVENT_GROUPS.flatMap(g => g.events)

export type NotificationChannel = 'webhook' | 'telegram'

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['webhook', 'telegram']

export interface Webhook {
  id: string
  channel: NotificationChannel
  url: string
  secret: string | null
  events: WebhookEventType[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  event: WebhookEventType
  payload: string
  statusCode: number | null
  response: string | null
  success: boolean
  duration: number | null
  createdAt: string
}

// ── Notes ───────────────────────────────────────────────

export interface Note {
  id: string
  title: string
  content: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

// ── Upgrade (lode supervisor) ───────────────────────────

export type LodeStatus =
  | 'starting'
  | 'running'
  | 'held'
  | 'updating'
  | 'rolling-back'
  | 'stopping'
  | 'stopped'
  | 'error'

export interface UpgradeHistoryEntry {
  version: string
  at: string
  result: 'good' | 'bad'
}

export interface UpgradeStatus {
  /** False when BKD runs outside lode (dev, or a bare `bun src/index.ts`). */
  supervised: boolean
  status: LodeStatus | null
  current: string | null
  lastGood: string | null
  available: string | null
  hasUpdate: boolean
  lastCheck: string | null
  lastError: string | null
  history: UpgradeHistoryEntry[]
}

export interface VersionInfo {
  version: string
  commit: string
  supervised: boolean
  activeVersion: string | null
}

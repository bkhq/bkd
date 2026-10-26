import type {
  ApiResponse,
  BusyAction,
  CategorizedCommands,
  ClaudeUsage,
  CodexUsage,
  DeleteLocalSessionsRequest,
  DeleteLocalSessionsResult,
  EngineDiscoveryResult,
  EngineProfile,
  EngineSettings,
  ExecuteIssueRequest,
  ExecuteIssueResponse,
  FileListingResult,
  FileUploadResult,
  ImportSessionRequest,
  ImportSessionResult,
  Issue,
  IssueChangesResponse,
  IssueFilePatchResponse,
  IssueLogsResponse,
  IssueSearchHit,
  IssueTurnsResponse,
  LocalSessionListResponse,
  LocalSessionPreview,
  Message,
  Note,
  PermissionMode,
  ProbeResult,
  Project,
  ProjectProcessesResponse,
  SkillFile,
  SkillFileEntry,
  SkillInfo,
  SkillLocation,
  SkillsOperation,
  SkillsOperationKind,
  SkillUpdateStatus,
  SkillUploadResult,
  UpgradeStatus,
  VirtualEngine,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
} from '@/types/kanban'
import { useUploadStore } from '@/stores/upload-store'

/** Encode a filesystem path as base58 for use in URL path segments. */
function encodeRootPath(path: string): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes = new TextEncoder().encode(path)
  let zeros = 0
  for (const b of bytes) {
    if (b === 0) zeros++
    else break
  }
  let num = 0n
  for (const b of bytes) num = num * 256n + BigInt(b)
  let encoded = ''
  while (num > 0n) {
    encoded = ALPHABET[Number(num % 58n)] + encoded
    num /= 58n
  }
  return '1'.repeat(zeros) + encoded
}

export class ApiError extends Error {
  readonly statusCode: number
  readonly isUserError: boolean

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    // 4xx errors are user-facing; 5xx are server errors
    this.isUserError = statusCode >= 400 && statusCode < 500
  }
}

// Cron types (frontend-only, matches backend REST response shape)
export interface CronJob {
  id: string
  name: string
  cron: string
  taskType: string
  taskConfig: Record<string, unknown>
  enabled: boolean
  status: string
  nextExecution: string | null
  lastRun: {
    status: string
    startedAt: string
    durationMs: number | null
    result: string | null
    error: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export interface CronJobLog {
  id: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: string
  result: string | null
  error: string | null
}

export interface CronJobLogsResponse {
  jobName: string
  logs: CronJobLog[]
  hasMore: boolean
  nextCursor: string | null
}

const DEFAULT_TIMEOUT_MS = 30_000 // 30 seconds

async function requestEnvelope<T>(url: string, options?: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {}

  // Wire up AbortController for timeout, chaining with any existing signal
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const existingSignal = fetchOptions.signal
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => controller.abort(existingSignal.reason))
  }

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...fetchOptions,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${timeoutMs}ms: ${url}`, 408)
    }
    throw err
  }
  clearTimeout(timer)

  const json = (await res.json()) as ApiResponse<T> & { nextCursor?: string | null, hasMore?: boolean }
  if (!json.success) {
    throw new ApiError(json.error, res.status)
  }
  return json
}

async function request<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  return (await requestEnvelope<T>(url, options)).data
}

function get<T>(url: string) {
  return request<T>(url)
}

function post<T>(url: string, body: unknown) {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body) })
}

function patch<T>(url: string, body: unknown) {
  return request<T>(url, { method: 'PATCH', body: JSON.stringify(body) })
}

function put<T>(url: string, body: unknown) {
  return request<T>(url, { method: 'PUT', body: JSON.stringify(body) })
}

function del<T>(url: string) {
  return request<T>(url, { method: 'DELETE' })
}

const UPLOAD_IDLE_TIMEOUT_MS = 60_000

/** Multipart POST via XHR so upload progress reaches the upload store. Aborts after 60s without progress. */
function postFormData<T>(url: string, formData: FormData): Promise<T> {
  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  const uploads = useUploadStore.getState()
  const uploadId = uploads.start(files)

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const armIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => xhr.abort(), UPLOAD_IDLE_TIMEOUT_MS)
    }
    const fail = (err: Error) => {
      clearTimeout(idleTimer)
      uploads.finish(uploadId, 'error')
      reject(err)
    }

    xhr.upload.onprogress = (e) => {
      armIdleTimer()
      if (e.lengthComputable) uploads.progress(uploadId, e.loaded, e.total)
    }
    xhr.onabort = () => fail(new ApiError(`Upload stalled for ${UPLOAD_IDLE_TIMEOUT_MS}ms: ${url}`, 408))
    xhr.onerror = () => fail(new TypeError(`Network error: ${url}`))
    xhr.onload = () => {
      clearTimeout(idleTimer)
      let json: ApiResponse<T>
      try {
        json = JSON.parse(xhr.responseText) as ApiResponse<T>
      } catch {
        fail(new ApiError(`Upload failed (HTTP ${xhr.status}): ${url}`, xhr.status))
        return
      }
      if (!json.success) {
        fail(new ApiError(json.error, xhr.status))
        return
      }
      uploads.finish(uploadId, 'done')
      resolve(json.data)
    }

    xhr.open('POST', url)
    armIdleTimer()
    xhr.send(formData)
  })
}

export const kanbanApi = {
  // Git
  detectGitRemote: (directory: string) =>
    post<{ url: string, remote: string }>('/api/git/detect-remote', {
      directory,
    }),

  // Filesystem
  listDirs: (path?: string) =>
    get<{ current: string, parent: string | null, dirs: string[] }>(
      `/api/filesystem/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),
  createDir: (path: string, name: string) =>
    post<{ path: string }>('/api/filesystem/dirs', { path, name }),

  // Projects
  getProjects: (opts?: { archived?: boolean }) =>
    get<Project[]>(`/api/projects${opts?.archived ? '?archived=true' : ''}`),
  getProject: (id: string) => get<Project>(`/api/projects/${id}`),
  createProject: (data: {
    name: string
    alias?: string
    description?: string
    directory?: string
    repositoryUrl?: string
    systemPrompt?: string
    envVars?: Record<string, string>
    tags?: string[]
  }) => post<Project>('/api/projects', data),
  updateProject: (
    id: string,
    data: {
      name?: string
      description?: string
      directory?: string
      repositoryUrl?: string
      systemPrompt?: string
      envVars?: Record<string, string>
      tags?: string[] | null
      defaultEngine?: string | null
      defaultModel?: string | null
      sortOrder?: number
    },
  ) => patch<Project>(`/api/projects/${id}`, data),
  deleteProject: (id: string) => del<{ id: string }>(`/api/projects/${id}`),
  archiveProject: (id: string) => post<Project>(`/api/projects/${id}/archive`, {}),
  unarchiveProject: (id: string) => post<Project>(`/api/projects/${id}/unarchive`, {}),
  sortProject: (id: string, sortOrder: string) =>
    patch<null>('/api/projects/sort', { id, sortOrder }),

  // Worktrees
  getWorktrees: (projectId: string) =>
    get<Array<{ issueId: string, path: string, branch: string | null }>>(
      `/api/projects/${projectId}/worktrees`,
    ),
  deleteWorktree: (projectId: string, issueId: string) =>
    del<{ issueId: string }>(`/api/projects/${projectId}/worktrees/${issueId}`),

  // Issues
  getReviewIssues: () =>
    get<Array<Issue & { projectName: string, projectAlias: string }>>('/api/issues/review'),
  getIssues: async (projectId: string): Promise<Issue[]> => {
    const issues: Issue[] = []
    let cursor: string | null = null
    do {
      const page: { data: Issue[], nextCursor?: string | null, hasMore?: boolean } = await requestEnvelope<Issue[]>(
        `/api/projects/${projectId}/issues${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      issues.push(...page.data)
      cursor = page.hasMore ? page.nextCursor ?? null : null
    } while (cursor)
    return issues
  },
  createIssue: (
    projectId: string,
    data: {
      title: string
      tags?: string[]
      statusId: string
      useWorktree?: boolean
      keepAlive?: boolean
      engineType?: string
      model?: string
      permissionMode?: string
      files?: File[]
    },
  ) => {
    const { files, ...rest } = data
    if (files && files.length > 0) {
      const fd = new FormData()
      fd.append('title', rest.title)
      fd.append('statusId', rest.statusId)
      if (rest.tags) fd.append('tags', JSON.stringify(rest.tags))
      if (rest.useWorktree !== undefined) fd.append('useWorktree', String(rest.useWorktree))
      if (rest.keepAlive !== undefined) fd.append('keepAlive', String(rest.keepAlive))
      if (rest.engineType) fd.append('engineType', rest.engineType)
      if (rest.model) fd.append('model', rest.model)
      if (rest.permissionMode) fd.append('permissionMode', rest.permissionMode)
      for (const file of files) fd.append('files', file)
      return postFormData<Issue>(`/api/projects/${projectId}/issues`, fd)
    }
    return post<Issue>(`/api/projects/${projectId}/issues`, rest)
  },
  updateIssue: (projectId: string, id: string, data: Partial<Issue>) =>
    patch<Issue>(`/api/projects/${projectId}/issues/${id}`, data),
  bulkUpdateIssues: (
    projectId: string,
    updates: Array<{
      id: string
      statusId?: string
      sortOrder?: string
    }>,
  ) => patch<Issue[]>(`/api/projects/${projectId}/issues/bulk`, { updates }),

  getIssue: (projectId: string, issueId: string) =>
    get<Issue>(`/api/projects/${projectId}/issues/${issueId}`),
  deleteIssue: (projectId: string, issueId: string) =>
    del<{ id: string }>(`/api/projects/${projectId}/issues/${issueId}`),
  duplicateIssue: (projectId: string, issueId: string) =>
    post<Issue>(`/api/projects/${projectId}/issues/${issueId}/duplicate`, {}),
  exportIssueUrl: (projectId: string, issueId: string) =>
    `/api/projects/${projectId}/issues/${issueId}/export?format=json`,

  // Issue session operations (merged from sessions)
  executeIssue: (projectId: string, issueId: string, data: ExecuteIssueRequest) =>
    post<ExecuteIssueResponse>(`/api/projects/${projectId}/issues/${issueId}/execute`, data),

  followUpIssue: (opts: {
    projectId: string
    issueId: string
    prompt: string
    model?: string
    permissionMode?: PermissionMode
    busyAction?: BusyAction
    files?: File[]
    displayPrompt?: string
  }) => {
    if (opts.files && opts.files.length > 0) {
      const fd = new FormData()
      fd.append('prompt', opts.prompt)
      if (opts.model) fd.append('model', opts.model)
      if (opts.permissionMode) fd.append('permissionMode', opts.permissionMode)
      if (opts.busyAction) fd.append('busyAction', opts.busyAction)
      if (opts.displayPrompt) fd.append('displayPrompt', opts.displayPrompt)
      for (const file of opts.files) fd.append('files', file)
      return postFormData<ExecuteIssueResponse>(
        `/api/projects/${opts.projectId}/issues/${opts.issueId}/follow-up`,
        fd,
      )
    }
    return post<ExecuteIssueResponse>(
      `/api/projects/${opts.projectId}/issues/${opts.issueId}/follow-up`,
      {
        prompt: opts.prompt,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        ...(opts.busyAction ? { busyAction: opts.busyAction } : {}),
        ...(opts.displayPrompt ? { displayPrompt: opts.displayPrompt } : {}),
      },
    )
  },

  cancelIssue: (projectId: string, issueId: string) =>
    post<{ issueId: string, status: string }>(
      `/api/projects/${projectId}/issues/${issueId}/cancel`,
      {},
    ),

  terminateIssue: (projectId: string, issueId: string) =>
    post<{ issueId: string, status: string }>(
      `/api/projects/${projectId}/issues/${issueId}/terminate`,
      {},
    ),

  restartIssue: (projectId: string, issueId: string) =>
    post<ExecuteIssueResponse>(`/api/projects/${projectId}/issues/${issueId}/restart`, {}),

  clearIssueSession: (projectId: string, issueId: string) =>
    post<{ issueId: string }>(
      `/api/projects/${projectId}/issues/${issueId}/clear-session`,
      {},
    ),

  deletePendingMessage: (projectId: string, issueId: string, messageId: string) =>
    del<{
      id: string
      content: string
      metadata: Record<string, unknown>
      attachments: Array<{
        id: string
        originalName: string
        mimeType: string
        size: number
      }>
    }>(
      `/api/projects/${projectId}/issues/${issueId}/pending?messageId=${encodeURIComponent(messageId)}`,
    ),

  getPendingMessages: (projectId: string, issueId: string) =>
    get<Array<{
      messageId: string
      content: string
      metadata: { type: string, attachments?: Array<{ id: string, name: string, mimeType: string, size: number }>, displayPrompt?: string } | null
      createdAt: string
    }>>(`/api/projects/${projectId}/issues/${issueId}/pending`),

  getIssueLogs: (
    projectId: string,
    issueId: string,
    opts?: { before?: string, cursor?: string, limit?: number, types?: readonly string[] },
  ) => {
    const params = new URLSearchParams()
    if (opts?.before) params.set('before', opts.before)
    if (opts?.cursor) params.set('cursor', opts.cursor)
    if (opts?.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    const base = `/api/projects/${projectId}/issues/${issueId}/logs`
    const filterSegment =
      opts?.types && opts.types.length > 0
        ? `/filter/types/${opts.types.join(',')}`
        : ''
    return get<IssueLogsResponse>(`${base}${filterSegment}${qs ? `?${qs}` : ''}`)
  },
  searchIssues: (projectId: string, q: string) =>
    get<IssueSearchHit[]>(`/api/projects/${projectId}/issues/search?q=${encodeURIComponent(q)}`),
  getIssueTurns: (projectId: string, issueId: string) =>
    get<IssueTurnsResponse>(`/api/projects/${projectId}/issues/${issueId}/turns`),
  getSlashCommands: (projectId: string, issueId: string) =>
    get<CategorizedCommands>(`/api/projects/${projectId}/issues/${issueId}/slash-commands`),
  getIssueChanges: (projectId: string, issueId: string) =>
    get<IssueChangesResponse>(`/api/projects/${projectId}/issues/${issueId}/changes`),
  getIssueFilePatch: (projectId: string, issueId: string, path: string) =>
    get<IssueFilePatchResponse>(
      `/api/projects/${projectId}/issues/${issueId}/changes/file?path=${encodeURIComponent(path)}`,
    ),

  // Engines
  getEngineAvailability: () => get<EngineDiscoveryResult>('/api/engines/available'),
  getEngineProfiles: () => get<EngineProfile[]>('/api/engines/profiles'),
  getClaudeUsage: () => get<ClaudeUsage>('/api/engines/claude/usage'),
  getCodexUsage: () => get<CodexUsage>('/api/engines/codex/usage'),
  getEngineSettings: () => get<EngineSettings>('/api/engines/settings'),
  updateEngineModelSetting: (engineType: string, data: { defaultModel: string }) =>
    patch<{ engineType: string, defaultModel: string }>(
      `/api/engines/${encodeURIComponent(engineType)}/settings`,
      data,
    ),
  updateDefaultEngine: (defaultEngine: string) =>
    patch<{ defaultEngine: string }>('/api/engines/default-engine', {
      defaultEngine,
    }),
  updateEngineHiddenModels: (engineType: string, data: { hiddenModels: string[] }) =>
    patch<{ engineType: string, hiddenModels: string[] }>(
      `/api/engines/${encodeURIComponent(engineType)}/hidden-models`,
      data,
    ),
  probeEngines: () => post<ProbeResult>('/api/engines/probe', {}),
  getVirtualEngines: () => get<VirtualEngine[]>('/api/engines/virtual'),
  setVirtualEngines: (engines: VirtualEngine[]) =>
    put<VirtualEngine[]>('/api/engines/virtual', { engines }),

  // App Settings
  getSlashCommandSettings: (engine?: string) =>
    get<CategorizedCommands>(
      `/api/settings/slash-commands${engine ? `?engine=${encodeURIComponent(engine)}` : ''}`,
    ),
  getWorkspacePath: () => get<{ path: string }>('/api/settings/workspace-path'),
  updateWorkspacePath: (path: string) =>
    patch<{ path: string }>('/api/settings/workspace-path', { path }),
  getLogPageSize: () => get<{ size: number }>('/api/settings/log-page-size'),
  setLogPageSize: (size: number) =>
    patch<{ size: number }>('/api/settings/log-page-size', { size }),
  getWorktreeAutoCleanup: () => get<{ enabled: boolean }>('/api/settings/worktree-auto-cleanup'),
  setWorktreeAutoCleanup: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/worktree-auto-cleanup', {
      enabled,
    }),
  getSkipPermissions: () => get<{ enabled: boolean }>('/api/settings/skip-permissions'),
  setSkipPermissions: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/skip-permissions', { enabled }),
  getDisableAskUser: () => get<{ enabled: boolean }>('/api/settings/disable-ask-user'),
  setDisableAskUser: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/disable-ask-user', { enabled }),
  getMaxConcurrentExecutions: () =>
    get<{ value: number }>('/api/settings/max-concurrent-executions'),
  setMaxConcurrentExecutions: (value: number) =>
    patch<{ value: number }>('/api/settings/max-concurrent-executions', {
      value,
    }),
  getCleanupStats: () =>
    get<{
      logs: { issueCount: number, logCount: number, toolCallCount: number, logFileSize: number }
      worktrees: { count: number, totalSize: number }
      deletedIssues: { issueCount: number, projectCount: number }
    }>('/api/settings/cleanup/stats'),
  runCleanup: (targets: Array<'logs' | 'worktrees' | 'deletedIssues'>) =>
    post<Record<string, { cleaned: number }>>('/api/settings/cleanup', {
      targets,
    }),
  getDeletedIssues: () =>
    get<
      Array<{
        id: string
        title: string
        projectId: string
        projectName: string
        statusId: string
        deletedAt: string | null
      }>
    >('/api/settings/deleted-issues'),
  restoreDeletedIssue: (id: string) =>
    post<{ id: string }>(`/api/settings/deleted-issues/${id}/restore`, {}),

  // Server Info
  getServerInfo: () =>
    get<{ name: string | null, url: string | null }>('/api/settings/server-info'),
  updateServerInfo: (data: { name?: string, url?: string }) =>
    patch<{ name: string | null, url: string | null }>('/api/settings/server-info', data),

  // System Logs
  getSystemLogs: (lines = 200) =>
    get<{ lines: string[], fileSize: number, totalLines: number }>(
      `/api/settings/system-logs?lines=${lines}`,
    ),
  downloadSystemLogs: () => `/api/settings/system-logs/download`,
  clearSystemLogs: () => post<{ cleared: boolean }>('/api/settings/system-logs/clear', {}),

  // About / System Info
  getSystemInfo: () =>
    get<{
      app: {
        version: string
        commit: string
        supervised: boolean
        activeVersion: string | null
        lode: { version: string, commit: string | null } | null
        startedAt: string
        uptime: number
      }
      runtime: {
        bun: string
        platform: string
        arch: string
        nodeVersion: string
      }
      server: {
        name: string | null
        url: string | null
      }
      process: {
        pid: number
      }
    }>('/api/settings/system-info'),

  // Upgrade (managed by the lode supervisor)
  getVersionInfo: () =>
    get<{
      version: string
      commit: string
      supervised: boolean
      activeVersion: string | null
      lode: { version: string, commit: string | null } | null
    }>('/api/settings/upgrade/version'),
  getUpgradeStatus: () =>
    get<UpgradeStatus>('/api/settings/upgrade/status'),
  checkForUpdate: () => post<{ status: string }>('/api/settings/upgrade/check', {}),
  requestUpgrade: (version?: string) =>
    post<{ requested: string }>('/api/settings/upgrade/update', version ? { version } : {}),
  requestRollback: (version?: string) =>
    post<{ requested: string }>('/api/settings/upgrade/rollback', version ? { version } : {}),
  restartServer: () => post<{ status: string }>('/api/settings/upgrade/restart', {}),

  // File Browser
  listFiles: (root: string, path?: string, hideIgnored?: boolean) => {
    const encodedRoot = encodeRootPath(root)
    const encodedPath =
      path && path !== '.' ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''
    const qs = hideIgnored ? '?hideIgnored=true' : ''
    return get<FileListingResult>(`/api/files/${encodedRoot}/show${encodedPath}${qs}`)
  },

  // Process Manager
  getAllProcesses: () =>
    get<ProjectProcessesResponse>('/api/processes'),

  terminateProcess: (issueId: string) =>
    post<{ issueId: string, status: string }>(
      `/api/processes/${issueId}/terminate`,
      {},
    ),

  rawFileUrl: (root: string, path: string) => {
    const encodedRoot = encodeRootPath(root)
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return `/api/files/${encodedRoot}/raw/${encodedPath}`
  },

  deleteFile: (root: string, path: string) => {
    const encodedRoot = encodeRootPath(root)
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return del<{ deleted: boolean }>(`/api/files/${encodedRoot}/delete/${encodedPath}`)
  },

  /** With `expectedModifiedAt`, the server answers 409 if the file changed on disk. */
  saveFile: (root: string, path: string, content: string, expectedModifiedAt?: string) => {
    const encodedRoot = encodeRootPath(root)
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return request<{ size: number, modifiedAt: string }>(
      `/api/files/${encodedRoot}/save/${encodedPath}`,
      { method: 'PUT', body: JSON.stringify({ content, expectedModifiedAt }) },
    )
  },

  uploadFiles: (root: string, path: string, files: File[], overwrite = false) => {
    const encodedRoot = encodeRootPath(root)
    const encodedPath =
      path && path !== '.' ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''
    const fd = new FormData()
    for (const file of files) fd.append('files', file)
    if (overwrite) fd.append('overwrite', 'true')
    return postFormData<FileUploadResult>(`/api/files/${encodedRoot}/upload${encodedPath}`, fd)
  },

  // Webhooks
  getWebhooks: () => get<Webhook[]>('/api/settings/webhooks'),
  createWebhook: (data: {
    channel?: string
    url: string
    secret?: string
    events: WebhookEventType[]
    isActive?: boolean
    interactive?: boolean
  }) => post<Webhook>('/api/settings/webhooks', data),
  updateWebhook: (
    id: string,
    data: {
      channel?: string
      url?: string
      secret?: string | null
      events?: WebhookEventType[]
      isActive?: boolean
      interactive?: boolean
    },
  ) => patch<Webhook>(`/api/settings/webhooks/${id}`, data),
  deleteWebhook: (id: string) => del<{ id: string }>(`/api/settings/webhooks/${id}`),
  getWebhookDeliveries: (id: string) =>
    get<WebhookDelivery[]>(`/api/settings/webhooks/${id}/deliveries`),
  testWebhook: (id: string) => post<{ sent: boolean }>(`/api/settings/webhooks/${id}/test`, {}),

  // Messages
  getMessages: () => get<Message[]>('/api/messages/items'),
  decideMessage: (id: string, data: { optionId?: string | null, instruction?: string }) =>
    post<Message>(`/api/messages/items/${id}/decision`, data),
  replyMessage: (id: string, text: string) =>
    post<Message>(`/api/messages/items/${id}/reply`, { text }),
  closeMessage: (id: string, reason?: string) =>
    post<Message>(`/api/messages/items/${id}/close`, { reason }),
  notifyMessage: (id: string) =>
    post<Message>(`/api/messages/items/${id}/notify`, {}),
  readMessage: (id: string) =>
    post<Message>(`/api/messages/items/${id}/read`, {}),
  readAllMessages: () =>
    post<{ ids: string[] }>('/api/messages/items/read', {}),

  // Skills
  getSkills: (projectId?: string) =>
    get<{ skills: SkillInfo[], cliAvailable: boolean }>(`/api/skills${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  getSkillFiles: (location: SkillLocation, name: string, projectId?: string) =>
    get<SkillFileEntry[]>(`/api/skills/${location}/${encodeURIComponent(name)}/files${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  getSkillFile: (location: SkillLocation, name: string, path: string, projectId?: string) =>
    get<SkillFile>(`/api/skills/${location}/${encodeURIComponent(name)}/file?${new URLSearchParams({ path, ...(projectId ? { projectId } : {}) })}`),
  saveSkillFile: (location: SkillLocation, name: string, data: { path: string, content: string, projectId?: string }) =>
    put<SkillFile>(`/api/skills/${location}/${encodeURIComponent(name)}/file`, data),
  createSkill: (data: { scope: 'global' | 'project', name: string, description: string, projectId?: string }) =>
    post<SkillInfo>('/api/skills', data),
  copySkill: (location: SkillLocation, name: string, data: { name: string, projectId?: string }) =>
    post<SkillInfo>(`/api/skills/${location}/${encodeURIComponent(name)}/copy`, data),
  startSkillsOperation: (data: {
    op: SkillsOperationKind
    scope: 'global' | 'project'
    projectId?: string
    source?: string
    skills?: string[]
    names?: string[]
    agents?: ('claude-code' | 'codex')[]
  }) => post<SkillsOperation>('/api/skills/operations', data),
  /** Without `location` and `name`, every installed skill is checked. */
  getSkillUpdates: (q: { projectId?: string, location?: SkillLocation, name?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString()
    return get<{ updates: SkillUpdateStatus[] }>(`/api/skills/updates${qs ? `?${qs}` : ''}`)
  },
  uploadSkills: (file: File, scope: 'global' | 'project', projectId?: string) => {
    const fd = new FormData()
    fd.append('scope', scope)
    if (projectId) fd.append('projectId', projectId)
    fd.append('files', file)
    return postFormData<SkillUploadResult>('/api/skills/upload', fd)
  },
  getSkillsOperation: (id: string) => get<SkillsOperation>(`/api/skills/operations/${encodeURIComponent(id)}`),
  cancelSkillsOperation: (id: string) => post<{ id: string }>(`/api/skills/operations/${encodeURIComponent(id)}/cancel`, {}),
  deleteSkill: (location: SkillLocation, name: string, projectId?: string) =>
    del<{ name: string }>(`/api/skills/${location}/${encodeURIComponent(name)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),

  // Notes
  getNotes: () => get<Note[]>('/api/notes'),
  createNote: (data: { title?: string, content?: string }) => post<Note>('/api/notes', data),
  updateNote: (id: string, data: { title?: string, content?: string, isPinned?: boolean }) =>
    patch<Note>(`/api/notes/${id}`, data),
  deleteNote: (id: string) => del<{ id: string }>(`/api/notes/${id}`),

  // Global Engine Environment Variables
  getGlobalEnvVars: () => get<Record<string, string>>('/api/settings/global-env-vars'),
  setGlobalEnvVars: (vars: Record<string, string>) =>
    put<Record<string, string>>('/api/settings/global-env-vars', { vars }),

  // Cron
  getCronJobs: () => get<CronJob[]>('/api/cron'),
  getCronJobLogs: (jobId: string, opts?: { status?: string, limit?: number, cursor?: string }) => {
    const params = new URLSearchParams()
    if (opts?.status) params.set('status', opts.status)
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.cursor) params.set('cursor', opts.cursor)
    const qs = params.toString()
    return get<CronJobLogsResponse>(`/api/cron/${jobId}/logs${qs ? `?${qs}` : ''}`)
  },
  pauseCronJob: (jobId: string) =>
    post<{ paused: boolean, name: string }>(`/api/cron/${jobId}/pause`, {}),
  resumeCronJob: (jobId: string) =>
    post<{ resumed: boolean, name: string }>(`/api/cron/${jobId}/resume`, {}),
  deleteCronJob: (jobId: string) =>
    del<{ deleted: boolean, name: string }>(`/api/cron/${jobId}`),

  // Local engine sessions recorded outside BKD
  getLocalSessions: (opts?: {
    engine?: string
    search?: string
    managed?: 'true' | 'false'
    limit?: number
    offset?: number
  }) => {
    const params = new URLSearchParams()
    if (opts?.engine) params.set('engine', opts.engine)
    if (opts?.search) params.set('search', opts.search)
    if (opts?.managed) params.set('managed', opts.managed)
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset) params.set('offset', String(opts.offset))
    const qs = params.toString()
    return get<LocalSessionListResponse>(`/api/sessions${qs ? `?${qs}` : ''}`)
  },
  getLocalSession: (engine: string, sessionId: string, opts?: { limit?: number }) => {
    const qs = opts?.limit ? `?limit=${opts.limit}` : ''
    return get<LocalSessionPreview>(`/api/sessions/${engine}/${encodeURIComponent(sessionId)}${qs}`)
  },
  importSession: (projectId: string, data: ImportSessionRequest) =>
    post<ImportSessionResult>(`/api/projects/${projectId}/issues/import-session`, data),
  deleteLocalSessions: (data: DeleteLocalSessionsRequest) =>
    post<DeleteLocalSessionsResult>('/api/sessions/bulk-delete', data),
}

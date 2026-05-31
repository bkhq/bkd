import type {
  ApiResponse,
  BusyAction,
  CategorizedCommands,
  EngineDiscoveryResult,
  EngineProfile,
  EngineSettings,
  ExecuteIssueRequest,
  ExecuteIssueResponse,
  FileListingResult,
  ForkIssuePayload,
  ForkIssueResult,
  Issue,
  IssueChangesResponse,
  IssueFilePatchResponse,
  IssueLogsResponse,
  Note,
  PermissionMode,
  ProbeResult,
  Project,
  ProjectProcessesResponse,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
  WhiteboardNode,
  Workspace,
} from '@/types/kanban'
import { clearToken, getToken } from './auth'

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
  isDeleted: boolean
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

export interface Role {
  id: string
  projectId: string
  name: string
  displayName: string
  description?: string
  avatar?: string
  type: 'internal' | 'external'
  issueId?: string
  endpoint?: string
  protocol?: 'http' | 'mcp'
  createdAt?: string
  updatedAt?: string
}

export interface CreateRolePayload {
  name: string
  displayName: string
  description?: string
  avatar?: string
  type: 'internal' | 'external'
  issueId?: string
  endpoint?: string
  protocol?: 'http' | 'mcp'
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

const DEFAULT_TIMEOUT_MS = 30_000 // 30 seconds

async function request<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
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
      headers: authHeaders(),
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

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new ApiError('Unauthorized', 401)
  }

  const json = (await res.json()) as ApiResponse<T>
  if (!json.success) {
    throw new ApiError(json.error, res.status)
  }
  return json.data
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

export interface UploadProgressEvent {
  /** Bytes the browser has finished transmitting for this request. */
  loaded: number
  /** Total bytes in the request body (multipart-encoded, not raw file size). */
  total: number
}

interface PostFormDataOptions {
  /** Default 5 minutes — upload time scales with file size and link speed. */
  timeoutMs?: number
  /** Fires repeatedly while the request body uploads. */
  onProgress?: (event: UploadProgressEvent) => void
  /** External cancel — calls xhr.abort() when triggered. */
  signal?: AbortSignal
}

const DEFAULT_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * POST a multipart/form-data request via XHR.
 *
 * Uses XMLHttpRequest (instead of fetch) so callers can observe upload
 * progress: `fetch` does not surface `upload.onprogress` events, only
 * download progress via the response body. For attachment uploads we
 * specifically want byte-level progress on the request body so users
 * can see a 100 MB project tarball move during the seconds-to-minutes
 * it takes to upload on slower links.
 */
async function postFormData<T>(
  url: string,
  formData: FormData,
  options?: PostFormDataOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS
  const token = getToken()

  return new Promise<T>((resolveResult, rejectResult) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const timer = setTimeout(() => {
      try {
        xhr.abort()
      } catch { /* ignore — XHR already settled */ }
      settle(() => rejectResult(new ApiError(`Upload timed out after ${timeoutMs}ms: ${url}`, 408)))
    }, timeoutMs)

    const onAbort = () => {
      try {
        xhr.abort()
      } catch { /* ignore — XHR already settled */ }
      clearTimeout(timer)
      settle(() => rejectResult(new ApiError('Upload aborted', 0)))
    }
    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer)
        settle(() => rejectResult(new ApiError('Upload aborted', 0)))
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    xhr.open('POST', url)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    // Browsers set Content-Type with the multipart boundary automatically
    // when the body is a FormData; never override it here.

    if (options?.onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          options.onProgress!({ loaded: e.loaded, total: e.total })
        }
      })
    }

    xhr.onload = () => {
      clearTimeout(timer)
      options?.signal?.removeEventListener('abort', onAbort)

      if (xhr.status === 401) {
        clearToken()
        window.location.href = '/login'
        settle(() => rejectResult(new ApiError('Unauthorized', 401)))
        return
      }

      let json: ApiResponse<T>
      try {
        json = JSON.parse(xhr.responseText) as ApiResponse<T>
      } catch {
        settle(() => rejectResult(new ApiError(`Malformed JSON from ${url}`, xhr.status)))
        return
      }
      if (!json.success) {
        settle(() => rejectResult(new ApiError(json.error, xhr.status)))
        return
      }
      settle(() => resolveResult(json.data))
    }

    xhr.onerror = () => {
      clearTimeout(timer)
      options?.signal?.removeEventListener('abort', onAbort)
      settle(() => rejectResult(new ApiError(`Network error during upload: ${url}`, 0)))
    }

    try {
      xhr.send(formData)
    } catch (err) {
      clearTimeout(timer)
      options?.signal?.removeEventListener('abort', onAbort)
      const msg = err instanceof Error ? err.message : 'send failed'
      settle(() => rejectResult(new ApiError(msg, 0)))
    }
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
      sortOrder?: number
    },
  ) => patch<Project>(`/api/projects/${id}`, data),
  deleteProject: (id: string) => del<{ id: string }>(`/api/projects/${id}`),
  archiveProject: (id: string) => post<Project>(`/api/projects/${id}/archive`, {}),
  unarchiveProject: (id: string) => post<Project>(`/api/projects/${id}/unarchive`, {}),
  sortProject: (id: string, sortOrder: string) =>
    patch<null>('/api/projects/sort', { id, sortOrder }),

  // Workspaces
  getWorkspaces: () => get<Workspace[]>('/api/workspaces'),
  getWorkspace: (id: string) => get<Workspace>(`/api/workspaces/${encodeURIComponent(id)}`),
  createWorkspace: (data: { name: string, description?: string, repos: { url: string, defaultBranch: string, role: string }[] }) => post<Workspace>('/api/workspaces', data),
  updateWorkspace: (id: string, data: { name?: string, description?: string }) => patch<Workspace>(`/api/workspaces/${encodeURIComponent(id)}`, data),
  deleteWorkspace: (id: string) => del<{ id: string }>(`/api/workspaces/${encodeURIComponent(id)}`),
  getWorkspaceProjects: (workspaceId: string) => get<Project[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/projects`),
  getIssueTree: (projectId: string) => get<any[]>(`/api/projects/${encodeURIComponent(projectId)}/issues?tree=true`),

  // Worktrees
  getWorktrees: (projectId: string) =>
    get<Array<{ issueId: string, path: string, branch: string | null }>>(
      `/api/projects/${projectId}/worktrees`,
    ),
  deleteWorktree: (projectId: string, issueId: string) =>
    del<{ issueId: string }>(`/api/projects/${projectId}/worktrees/${issueId}`),

  // Issues
  getReviewIssues: (opts?: { statuses?: string[] }) => {
    const qs = opts?.statuses && opts.statuses.length > 0 ?
      `?statuses=${encodeURIComponent(opts.statuses.join(','))}` :
      ''
    return get<Array<Issue & { projectName: string, projectAlias: string }>>(
      `/api/issues/review${qs}`,
    )
  },
  getIssueStats: () =>
    get<Array<{
      projectId: string
      projectName: string
      projectAlias: string
      counts: { todo: number, working: number, review: number, done: number }
      total: number
    }>>('/api/issues/stats'),

  // Cockpit assistant
  getCockpitAssistant: () =>
    get<{
      issueId: string
      projectId: string
      projectAlias: string
      projectName: string
    }>('/api/cockpit/assistant'),
  cockpitAsk: (prompt: string, model?: string) =>
    post<{ issueId: string, executionId: string, firstTurn: boolean }>(
      '/api/cockpit/ask',
      { prompt, ...(model ? { model } : {}) },
    ),
  cockpitReset: () =>
    post<{ deletedIssueId: string | null }>('/api/cockpit/reset', {}),
  cockpitSetEngine: (engineType: string) =>
    post<{ issueId: string, engineType: string }>('/api/cockpit/engine', { engineType }),
  getIssueAiTimeline: (projectId: string, issueId: string, path: string) =>
    get<{
      path: string
      baselineSource: 'edit' | 'write' | 'none'
      baseline: string
      finalBuffer: string
      netAdditions: number
      netDeletions: number
      status: 'reverted' | 'write-only' | 'clean'
      edits: Array<{
        turnIndex: number
        entryIndex: number
        at: string
        toolName: string
        bufferLinesAfter: number
        additions: number
        deletions: number
        skipped: boolean
        summary: string
      }>
    } | null>(`/api/projects/${projectId}/issues/${issueId}/ai-changes/file?path=${encodeURIComponent(path)}`),

  getIssueAiChanges: (projectId: string, issueId: string) =>
    get<{
      root: string | null
      gitRepo: boolean
      timedOut: boolean
      onDisk: Array<{
        path: string
        rawPath: string
        toolName: string
        editCount: number
        firstTurnIndex: number
        lastTurnIndex: number
        lastTouchAt: string
        status: 'edited' | 'created' | 'maybe-deleted'
      }>
      reverted: Array<{
        path: string
        rawPath: string
        toolName: string
        editCount: number
        firstTurnIndex: number
        lastTurnIndex: number
        lastTouchAt: string
        status: 'edited' | 'created' | 'maybe-deleted'
      }>
      dirtyNotTouched: string[]
    }>(`/api/projects/${projectId}/issues/${issueId}/ai-changes`),

  getCockpitRecentActivity: (limit = 20) =>
    get<Array<{
      issueId: string
      title: string
      projectAlias: string
      sessionStatus: string | null
      statusId: string
      statusUpdatedAt: string
    }>>(`/api/cockpit/recent-activity?limit=${limit}`),
  listCockpitProposals: () =>
    get<Array<{
      id: string
      type: 'cancel_issue' | 'restart_issue' | 'bulk_update_status' | 'create_issue'
      summary: string
      params: Record<string, unknown>
      status: string
      createdAt: number
    }>>('/api/cockpit/proposals'),
  approveCockpitProposal: (id: string) =>
    post<{ status: string, result?: unknown }>(`/api/cockpit/proposals/${id}/approve`, {}),
  rejectCockpitProposal: (id: string) =>
    post<{ status: string }>(`/api/cockpit/proposals/${id}/reject`, {}),

  // Cockpit timeline (COCKPIT-007)
  listCockpitTimeline: (opts: { limit?: number, before?: number } = {}) => {
    const qs = new URLSearchParams()
    if (opts.limit != null) qs.set('limit', String(opts.limit))
    if (opts.before != null) qs.set('before', String(opts.before))
    const tail = qs.toString()
    return get<{
      messages: import('@bkd/shared').CockpitTimelineMessage[]
      counts: Record<import('@bkd/shared').CockpitTimelineMessageKind, number>
    }>(`/api/cockpit/timeline${tail ? `?${tail}` : ''}`)
  },
  ackCockpitTimelineMessage: (id: string) =>
    post<import('@bkd/shared').CockpitTimelineMessage>(`/api/cockpit/timeline/${id}/ack`, {}),
  dismissCockpitTimelineMessage: (id: string) =>
    post<import('@bkd/shared').CockpitTimelineMessage>(`/api/cockpit/timeline/${id}/dismiss`, {}),
  snoozeCockpitTimelineMessage: (id: string, untilMs: number) =>
    post<import('@bkd/shared').CockpitTimelineMessage>(`/api/cockpit/timeline/${id}/snooze`, { untilMs }),
  /**
   * One-shot proposal: create and approve in a single request. Used by the
   * always-on bot timeline action buttons where the click *is* the approval.
   */
  executeCockpitAction: (type: string, params: Record<string, unknown>) =>
    post<{ proposalId: string, status: string, result?: unknown }>(
      '/api/cockpit/proposals/execute',
      { type, params },
    ),

  // Issue templates
  listIssueTemplates: () =>
    get<Array<{
      id: string
      name: string
      source: 'builtin' | 'user'
      titlePattern?: string
      promptPrefix?: string
      defaultStatusId?: 'todo' | 'working' | 'review' | 'done'
      defaultTags?: string[]
    }>>('/api/issue-templates'),

  // Cross-project (or per-issue, via opts.issueId) log search (FTS5)
  searchLogs: (query: string, limit = 30, opts?: { issueId?: string }) => {
    const params = new URLSearchParams()
    params.set('q', query)
    params.set('limit', String(limit))
    if (opts?.issueId) params.set('issueId', opts.issueId)
    return get<Array<{
      logId: string
      issueId: string
      issueTitle: string
      projectAlias: string
      projectName: string
      entryType: string
      content: string
      createdAt: string
      score: number
    }>>(`/api/search/logs?${params.toString()}`)
  },
  getLogsAround: (
    projectId: string,
    issueId: string,
    logId: string,
    windowSize = 20,
  ) =>
    get<IssueLogsResponse>(
      `/api/projects/${projectId}/issues/${issueId}/logs/around/${logId}?window=${windowSize}`,
    ),
  getIssues: (projectId: string) => get<Issue[]>(`/api/projects/${projectId}/issues`),
  createIssue: (
    projectId: string,
    data: {
      title: string
      tags?: string[]
      statusId: string
      useWorktree?: boolean
      engineType?: string
      model?: string
      permissionMode?: string
    },
  ) => post<Issue>(`/api/projects/${projectId}/issues`, data),
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
  forkIssue: (projectId: string, issueId: string, data: ForkIssuePayload) =>
    post<ForkIssueResult>(`/api/projects/${projectId}/issues/${issueId}/fork`, data),
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
    /** Fires while a multipart upload is in flight. Ignored for the JSON path. */
    onUploadProgress?: (event: UploadProgressEvent) => void
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
        { onProgress: opts.onUploadProgress },
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

  clearAllPendingMessages: (projectId: string, issueId: string) =>
    del<{ count: number }>(`/api/projects/${projectId}/issues/${issueId}/pending`),

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
  getSlashCommands: (projectId: string, issueId: string) =>
    get<CategorizedCommands>(`/api/projects/${projectId}/issues/${issueId}/slash-commands`),
  getIssueChanges: (projectId: string, issueId: string) =>
    get<IssueChangesResponse>(`/api/projects/${projectId}/issues/${issueId}/changes`),
  getIssueFilePatch: (projectId: string, issueId: string, path: string) =>
    get<IssueFilePatchResponse>(
      `/api/projects/${projectId}/issues/${issueId}/changes/file?path=${encodeURIComponent(path)}`,
    ),

  // Role API
  getRoles: (projectId: string) =>
    get<Role[]>(`/api/projects/${projectId}/roles`),

  createRole: (projectId: string, data: CreateRolePayload) =>
    post<Role>(`/api/projects/${projectId}/roles`, data),

  updateRole: (projectId: string, roleId: string, data: Partial<CreateRolePayload>) =>
    patch<Role>(`/api/projects/${projectId}/roles/${roleId}`, data),

  deleteRole: (projectId: string, roleId: string) =>
    del<void>(`/api/projects/${projectId}/roles/${roleId}`),

  invokeRole: (projectId: string, issueId: string, roleId: string, data: { roleName: string, message: string, context?: string }) =>
    post<{ type: string, roleId: string, executionId?: string }>(`/api/projects/${projectId}/issues/${issueId}/roles/${roleId}/invoke`, data),

  getIssueRoles: (projectId: string, issueId: string) =>
    get<Role[]>(`/api/projects/${projectId}/issues/${issueId}/roles`),

  assignRole: (projectId: string, issueId: string, roleId: string) =>
    post<{ id: string }>(`/api/projects/${projectId}/issues/${issueId}/roles`, { roleId }),

  removeRole: (projectId: string, issueId: string, roleId: string) =>
    del<void>(`/api/projects/${projectId}/issues/${issueId}/roles/${roleId}`),

  getIssueParticipants: (projectId: string, issueId: string) =>
    get<{ humans: unknown[], roles: Role[] }>(`/api/projects/${projectId}/issues/${issueId}/participants`),

  // Engines
  getEngineAvailability: () => get<EngineDiscoveryResult>('/api/engines/available'),
  getEngineProfiles: () => get<EngineProfile[]>('/api/engines/profiles'),
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
  getOmitModel: () => get<{ enabled: boolean }>('/api/settings/omit-model'),
  setOmitModel: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/omit-model', { enabled }),
  getMaxConcurrentExecutions: () =>
    get<{ value: number }>('/api/settings/max-concurrent-executions'),
  setMaxConcurrentExecutions: (value: number) =>
    patch<{ value: number }>('/api/settings/max-concurrent-executions', {
      value,
    }),
  getCleanupStats: () =>
    get<{
      logs: { issueCount: number, logCount: number, toolCallCount: number, logFileSize: number }
      oldVersions: {
        items: Array<{ name: string, size: number }>
        totalSize: number
      }
      worktrees: { count: number, totalSize: number }
      deletedIssues: { issueCount: number, projectCount: number }
    }>('/api/settings/cleanup/stats'),
  runCleanup: (targets: Array<'logs' | 'oldVersions' | 'worktrees' | 'deletedIssues'>) =>
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
        isCompiled: boolean
        isPackageMode: boolean
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

  // Upgrade
  getVersionInfo: () =>
    get<{
      version: string
      commit: string
      isCompiled: boolean
      isPackageMode: boolean
    }>('/api/settings/upgrade/version'),
  getUpgradeEnabled: () => get<{ enabled: boolean }>('/api/settings/upgrade/enabled'),
  setUpgradeEnabled: (enabled: boolean) =>
    patch<{ enabled: boolean }>('/api/settings/upgrade/enabled', { enabled }),
  getUpgradeCheck: () =>
    get<{
      hasUpdate: boolean
      currentVersion: string
      currentCommit: string
      latestVersion: string | null
      latestTag: string | null
      publishedAt: string | null
      downloadUrl: string | null
      checksumUrl: string | null
      assetName: string | null
      assetSize: number | null
      downloadFileName: string | null
      checkedAt: string
    } | null>('/api/settings/upgrade/check'),
  checkForUpdates: () =>
    post<{
      hasUpdate: boolean
      currentVersion: string
      currentCommit: string
      latestVersion: string | null
      latestTag: string | null
      publishedAt: string | null
      downloadUrl: string | null
      checksumUrl: string | null
      assetName: string | null
      assetSize: number | null
      downloadFileName: string | null
      checkedAt: string
    }>('/api/settings/upgrade/check', {}),
  downloadUpdate: (url: string, fileName: string, checksumUrl?: string) =>
    post<{ status: string, fileName: string }>('/api/settings/upgrade/download', {
      url,
      fileName,
      ...(checksumUrl ? { checksumUrl } : {}),
    }),
  getDownloadStatus: () =>
    get<{
      status: 'idle' | 'downloading' | 'verifying' | 'verified' | 'completed' | 'failed'
      progress: number
      fileName: string | null
      filePath: string | null
      error: string | null
      checksumMatch: boolean | null
    }>('/api/settings/upgrade/download/status'),
  restartWithUpgrade: () => post<{ status: string }>('/api/settings/upgrade/restart', {}),
  listLocalVersions: () =>
    get<Array<{ version: string, isCurrent: boolean }>>(
      '/api/settings/upgrade/local-versions',
    ),
  applyLocalVersion: (version: string) =>
    post<{ status: string, version: string }>('/api/settings/upgrade/apply-local', {
      version,
    }),

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

  saveFile: (root: string, path: string, content: string) => {
    const encodedRoot = encodeRootPath(root)
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return request<{ size: number, modifiedAt: string }>(
      `/api/files/${encodedRoot}/save/${encodedPath}`,
      { method: 'PUT', body: JSON.stringify({ content }) },
    )
  },

  // Webhooks
  getWebhooks: () => get<Webhook[]>('/api/settings/webhooks'),
  createWebhook: (data: {
    channel?: string
    url: string
    secret?: string
    events: WebhookEventType[]
    isActive?: boolean
  }) => post<Webhook>('/api/settings/webhooks', data),
  updateWebhook: (
    id: string,
    data: {
      channel?: string
      url?: string
      secret?: string | null
      events?: WebhookEventType[]
      isActive?: boolean
    },
  ) => patch<Webhook>(`/api/settings/webhooks/${id}`, data),
  deleteWebhook: (id: string) => del<{ id: string }>(`/api/settings/webhooks/${id}`),
  getWebhookDeliveries: (id: string) =>
    get<WebhookDelivery[]>(`/api/settings/webhooks/${id}/deliveries`),
  testWebhook: (id: string) => post<{ sent: boolean }>(`/api/settings/webhooks/${id}/test`, {}),

  // Issue Summary
  summarizeIssue: (projectId: string, issueId: string) =>
    post<Note>(`/api/projects/${projectId}/issues/${issueId}/summarize`, {}),

  // Notes
  getNotes: (opts?: { projectId?: string, archived?: boolean }) => {
    const params = new URLSearchParams()
    if (opts?.projectId) params.set('projectId', opts.projectId)
    if (opts?.archived) params.set('archived', 'true')
    const qs = params.toString()
    return get<Note[]>(`/api/notes${qs ? `?${qs}` : ''}`)
  },
  createNote: (data: {
    title?: string
    content?: string
    projectId?: string
    issueId?: string
    source?: 'manual' | 'ai-summary' | 'ai-pattern'
    tags?: string[]
  }) => post<Note>('/api/notes', data),
  updateNote: (
    id: string,
    data: {
      title?: string
      content?: string
      isPinned?: boolean
      isArchived?: boolean
      tags?: string[]
    },
  ) => patch<Note>(`/api/notes/${id}`, data),
  deleteNote: (id: string) => del<{ id: string }>(`/api/notes/${id}`),
  queryNotes: (data: { prompt: string, projectId?: string, limit?: number }) =>
    post<Array<Note & { score: number }>>('/api/notes/query', data),

  // Global Engine Environment Variables
  getGlobalEnvVars: () => get<Record<string, string>>('/api/settings/global-env-vars'),
  setGlobalEnvVars: (vars: Record<string, string>) =>
    put<Record<string, string>>('/api/settings/global-env-vars', { vars }),

  // Whiteboard
  getWhiteboardNodes: (projectId: string) =>
    get<WhiteboardNode[]>(`/api/projects/${projectId}/whiteboard/nodes`),
  createWhiteboardNode: (projectId: string, data: {
    parentId?: string | null
    label?: string
    content?: string
    icon?: string
    sortOrder?: string
    metadata?: Record<string, unknown>
  }) => post<WhiteboardNode>(`/api/projects/${projectId}/whiteboard/nodes`, data),
  updateWhiteboardNode: (projectId: string, nodeId: string, data: {
    parentId?: string | null
    label?: string
    content?: string
    icon?: string
    sortOrder?: string
    isCollapsed?: boolean
    metadata?: Record<string, unknown>
    boundIssueId?: string | null
  }) => patch<WhiteboardNode>(`/api/projects/${projectId}/whiteboard/nodes/${nodeId}`, data),
  deleteWhiteboardNode: (projectId: string, nodeId: string) =>
    del<{ ids: string[] }>(`/api/projects/${projectId}/whiteboard/nodes/${nodeId}`),
  bulkUpdateWhiteboardNodes: (projectId: string, nodes: Array<{
    id: string
    parentId?: string | null
    sortOrder?: string
  }>) => patch<WhiteboardNode[]>(`/api/projects/${projectId}/whiteboard/nodes/bulk`, { nodes }),
  resetWhiteboard: (projectId: string) =>
    del<{ count: number }>(`/api/projects/${projectId}/whiteboard/nodes`),
  whiteboardAsk: (projectId: string, data: {
    // Optional focal node (context); omit to ask about the whole board.
    nodeId?: string
    prompt: string
    engineType?: string
    model?: string
  }) => post<{ issueId: string, executionId?: string, queued?: boolean }>(
    `/api/projects/${projectId}/whiteboard/ask`,
    data,
  ),
  parseWhiteboardResponse: (projectId: string, data: { nodeId: string, issueId: string, skipInsert?: boolean }) =>
    post<{ nodes: WhiteboardNode[], rawContent: string }>(`/api/projects/${projectId}/whiteboard/parse-response`, data),
  generateIssuesFromNodes: (projectId: string, data: { nodeIds: string[] }) =>
    post<Array<{ nodeId: string, title: string, prompt: string }>>(
      `/api/projects/${projectId}/whiteboard/generate-issues`,
      data,
    ),

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
}

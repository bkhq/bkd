import * as z from 'zod'
import { IssueSchema, NormalizedLogEntrySchema, WriteFilterRuleSchema } from './schemas'

export const EnabledSchema = z.object({ enabled: z.boolean() })
export const EnvironmentSchema = z.record(z.string(), z.string())
export const VirtualEngineSchema = z.object({
  id: z.string().regex(/^[\w.\-:]{1,64}$/),
  name: z.string().min(1).max(100),
  baseEngine: z.enum(['claude-code', 'codex']),
  baseUrl: z.string().url().max(512).optional(),
  authToken: z.string().max(512).optional(),
  model: z.string().max(160).optional(),
  envVars: EnvironmentSchema.refine(obj => Object.keys(obj).length <= 50, {
    message: 'Maximum 50 environment variables allowed',
  }),
})
export const VirtualEnginesSchema = z.array(VirtualEngineSchema)
export const DirectorySchema = z.object({ current: z.string(), parent: z.string().nullable(), dirs: z.array(z.string()) })
export const GitRemoteSchema = z.object({ url: z.string(), remote: z.string() })
export const PendingMessagesSchema = z.array(z.object({
  messageId: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
}))
export const RecalledMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  attachments: z.array(z.object({ id: z.string(), originalName: z.string(), mimeType: z.string(), size: z.number() })),
})
export const ReviewIssuesSchema = z.array(IssueSchema.extend({ projectName: z.string(), projectAlias: z.string() }))
export const FilePatchSchema = z.object({
  path: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
  oldText: z.string().optional(),
  newText: z.string().optional(),
  timedOut: z.boolean().optional(),
  oversized: z.boolean().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  sizeDisplay: z.string().optional(),
})
export const ExportSchema = z.object({
  issue: z.object({ id: z.string(), title: z.string(), issueNumber: z.number() }),
  logs: z.array(NormalizedLogEntrySchema),
})
export const DeletedIssuesSchema = z.array(z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  statusId: z.string(),
  deletedAt: z.string().nullable(),
}))
export const SystemLogsSchema = z.object({ lines: z.array(z.string()), fileSize: z.number(), totalLines: z.number().optional() })
export const CleanupStatsSchema = z.object({
  logs: z.object({ issueCount: z.number(), logCount: z.number(), toolCallCount: z.number(), logFileSize: z.number() }),
  worktrees: z.object({ count: z.number(), totalSize: z.number() }),
  deletedIssues: z.object({ issueCount: z.number(), projectCount: z.number() }),
})
export const CleanupResultSchema = z.record(z.string(), z.object({ cleaned: z.number() }))
export const VersionInfoSchema = z.object({
  version: z.string(),
  commit: z.string(),
  supervised: z.boolean(),
  activeVersion: z.string().nullable(),
})
export const UpgradeStatusSchema = z.object({
  supervised: z.boolean(),
  status: z.string().nullable(),
  current: z.string().nullable(),
  lastGood: z.string().nullable(),
  available: z.string().nullable(),
  hasUpdate: z.boolean(),
  target: z.string().nullable(),
  lastCheck: z.string().nullable(),
  lastError: z.string().nullable(),
  history: z.array(z.object({ at: z.string(), version: z.string(), result: z.enum(['good', 'bad']) })),
})
export const SystemInfoSchema = z.object({
  app: VersionInfoSchema.extend({ startedAt: z.string(), uptime: z.number() }),
  runtime: z.object({ bun: z.string(), platform: z.string(), arch: z.string(), nodeVersion: z.string() }),
  server: z.object({ name: z.string().nullable(), url: z.string().nullable() }),
  process: z.object({ pid: z.number() }),
})
export const SaveFileSchema = z.object({ content: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 5 * 1024 * 1024, 'Content exceeds maximum size of 5 MB') })
export const SavedFileSchema = z.object({ size: z.number(), modifiedAt: z.string() })
export const UploadedFilesSchema = z.object({ uploaded: z.array(z.object({ name: z.string(), size: z.number() })) })
export const FileListingSchema = z.union([
  z.object({
    path: z.string(),
    type: z.literal('file'),
    content: z.string(),
    size: z.number(),
    isTruncated: z.boolean(),
    isBinary: z.boolean(),
  }),
  z.object({
    path: z.string(),
    type: z.literal('directory'),
    entries: z.array(z.object({ name: z.string(), type: z.enum(['file', 'directory']), size: z.number(), modifiedAt: z.string() })),
  }),
])
export { WriteFilterRuleSchema }

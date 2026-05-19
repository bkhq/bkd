import * as z from 'zod'
import { getAppSetting, setAppSetting } from '@/db/helpers'

const APP_SETTING_KEY = 'cockpit:issueTemplates'

export const issueTemplateSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]{0,59}$/i),
  name: z.string().min(1).max(80),
  titlePattern: z.string().max(280).optional(),
  promptPrefix: z.string().max(2000).optional(),
  defaultStatusId: z.enum(['todo', 'working', 'review', 'done']).optional(),
  defaultTags: z.array(z.string().max(50)).max(10).optional(),
})

export type IssueTemplate = z.infer<typeof issueTemplateSchema>

export type IssueTemplateRecord = IssueTemplate & { source: 'builtin' | 'user' }

const BUILTIN: IssueTemplate[] = [
  {
    id: 'bug-fix',
    name: 'Bug fix',
    titlePattern: 'Fix: <symptom> in <area>',
    promptPrefix:
      'You are fixing a bug. Reproduce first, then identify the root cause (do not patch symptoms), then write a minimal fix and a regression test.\n\nUser report:\n',
    defaultStatusId: 'todo',
    defaultTags: ['bug'],
  },
  {
    id: 'refactor',
    name: 'Refactor',
    titlePattern: 'Refactor <module>: <goal>',
    promptPrefix:
      'You are refactoring existing code. Preserve behavior. Outline the change in plan mode, then execute. Add tests for any behavior that was previously untested but is now exposed.\n\nScope:\n',
    defaultStatusId: 'todo',
    defaultTags: ['refactor'],
  },
  {
    id: 'add-tests',
    name: 'Add tests',
    titlePattern: 'Add tests for <area>',
    promptPrefix:
      'Add focused, meaningful tests for the area below. Prefer the existing test framework. Cover happy path + at least one failure path. Do not modify production code unless required to enable testability (call out any such change).\n\nTarget:\n',
    defaultStatusId: 'todo',
    defaultTags: ['tests'],
  },
  {
    id: 'investigate',
    name: 'Investigation',
    titlePattern: 'Investigate: <question>',
    promptPrefix:
      'Investigate the question below in read-only mode. Trace call sites, read configs, summarize findings. Do not modify code. Output a short report ending with concrete recommendations.\n\nQuestion:\n',
    defaultStatusId: 'todo',
    defaultTags: ['investigation'],
  },
  {
    id: 'follow-up',
    name: 'Follow-up from review',
    titlePattern: 'Follow-up: <what>',
    promptPrefix:
      'A previous AI run completed but the reviewer flagged the items below. Address each item; keep the diff minimal and self-contained.\n\nReview notes:\n',
    defaultStatusId: 'todo',
    defaultTags: ['follow-up'],
  },
]

export async function listTemplates(): Promise<IssueTemplateRecord[]> {
  const raw = await getAppSetting(APP_SETTING_KEY)
  let user: IssueTemplate[] = []
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        for (const candidate of parsed) {
          const result = issueTemplateSchema.safeParse(candidate)
          if (result.success) user.push(result.data)
        }
      }
    } catch {
      user = []
    }
  }
  // user templates can override builtins by id
  const userIds = new Set(user.map(t => t.id))
  const builtins: IssueTemplateRecord[] = BUILTIN
    .filter(t => !userIds.has(t.id))
    .map(t => ({ ...t, source: 'builtin' }))
  const userRecords: IssueTemplateRecord[] = user.map(t => ({ ...t, source: 'user' }))
  return [...builtins, ...userRecords]
}

export async function saveUserTemplates(templates: IssueTemplate[]): Promise<number> {
  // Validation done by caller via zod; we just persist.
  await setAppSetting(APP_SETTING_KEY, JSON.stringify(templates))
  return templates.length
}

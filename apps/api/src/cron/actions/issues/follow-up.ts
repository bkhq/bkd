import { issueEngine } from '@/engines/issue'
import { ensureWorking } from '@/routes/issues/_shared'
import { registerAction } from '../registry'
import { resolveIssue, validateIssueRefs } from './resolver'

registerAction('issue-follow-up', {
  description: 'Send a follow-up message to an issue',
  category: 'issue',
  requiredFields: ['projectId', 'issueId', 'prompt'],
  validate: validateIssueRefs,
  async handler(config) {
    const { project, issue } = await resolveIssue(config)
    const prompt = config.prompt as string

    // Tracked across ensureWorking() and the spawn, so the reconciler does not
    // read the 'working' issue as stale while it is starting.
    const result = await issueEngine.trackStart(issue.id, async () => {
      const guard = await ensureWorking(issue)
      if (!guard.ok) throw new Error(guard.reason!)

      return issueEngine.followUpIssue(
        issue.id,
        prompt,
        (config.model as string) ?? issue.model ?? undefined,
      )
    })

    return `follow-up sent to issue ${issue.id} in project ${project.id} (executionId: ${result.executionId})`
  },
})

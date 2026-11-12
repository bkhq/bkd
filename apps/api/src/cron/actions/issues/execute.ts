import { startIssueExecution } from '@/routes/issues/_shared'
import { registerAction } from '../registry'
import { resolveIssue, validateIssueRefs } from './resolver'

registerAction('issue-execute', {
  description: 'Start AI engine execution on an issue',
  category: 'issue',
  requiredFields: ['projectId', 'issueId', 'prompt'],
  validate: validateIssueRefs,
  async handler(config) {
    const { project, issue } = await resolveIssue(config)
    const prompt = config.prompt as string

    // Skip if issue already has an active session
    if (issue.sessionStatus === 'running' || issue.sessionStatus === 'pending') {
      return `skipped: issue ${issue.id} already has active session (${issue.sessionStatus})`
    }

    const result = await startIssueExecution(project, issue, {
      prompt,
      engineType: (config.engineType as string) ?? issue.engineType ?? 'claude-code',
      model: (config.model as string) ?? issue.model ?? undefined,
    })
    if (!result.ok) throw new Error(result.error)

    return `execution started for issue ${issue.id} in project ${project.id} (executionId: ${result.executionId})`
  },
})

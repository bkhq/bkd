import { registerAction } from '../registry'
import { resolveIssue } from './resolver'

registerAction('issue-check-status', {
  description: 'Check current status of an issue (useful for monitoring)',
  category: 'issue',
  requiredFields: ['projectId', 'issueId'],
  async handler(config) {
    const { issue } = await resolveIssue(config)

    return JSON.stringify({
      issueId: issue.id,
      statusId: issue.statusId,
      sessionStatus: issue.sessionStatus,
      engineType: issue.engineType,
      model: issue.model,
      updatedAt: issue.updatedAt,
      statusUpdatedAt: issue.statusUpdatedAt,
    })
  },
})

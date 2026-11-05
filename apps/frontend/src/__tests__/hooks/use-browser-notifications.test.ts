import type { BrowserNotificationEvent } from '@bkd/shared'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { toBrowserNotification } from '@/hooks/use-browser-notifications'

const t = ((key: string) => `<${key}>`) as unknown as TFunction

const base: BrowserNotificationEvent = {
  webhookId: 'w1',
  event: 'issue.status.review',
  title: 'Fix login',
  projectName: 'Web',
  projectId: 'p1',
  issueId: 'i1',
  messageId: null,
}

describe('toBrowserNotification', () => {
  it('titles an issue event with the issue and labels it with project and event', () => {
    expect(toBrowserNotification(base, t)).toEqual({
      title: 'Fix login',
      body: 'Web · <settings.webhooksEventStatusReview>',
      tag: 'issue.status.review:i1',
      renotify: true,
    })
  })

  it('tags a message event by message id', () => {
    const data = { ...base, event: 'message.sent' as const, projectId: null, issueId: null, messageId: 'm1' }
    expect(toBrowserNotification(data, t).tag).toBe('message.sent:m1')
  })

  it('falls back to the event label without a project', () => {
    const data = { ...base, projectName: null, issueId: 'test', projectId: null }
    expect(toBrowserNotification(data, t).body).toBe('<settings.webhooksEventStatusReview>')
  })
})

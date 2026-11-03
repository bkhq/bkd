import type { BrowserNotificationEvent } from '@bkd/shared'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { eventBus } from '@/lib/event-bus'
import { EVENT_LABEL_KEYS } from '@/lib/webhook-events'
import { useMessagesStore } from '@/stores/messages-store'

export function toBrowserNotification(data: BrowserNotificationEvent, t: TFunction) {
  const label = t(EVENT_LABEL_KEYS[data.event])
  return {
    title: data.title,
    body: data.projectName ? `${data.projectName} · ${label}` : label,
    // One notification per item and event, however many tabs or channels deliver it
    tag: `${data.event}:${data.issueId ?? data.messageId ?? data.webhookId}`,
    // A same-tag notification otherwise replaces the shown one silently
    renotify: true,
  }
}

type BrowserNotificationPermission = NotificationPermission | 'unsupported'

function currentPermission(): BrowserNotificationPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** The browser's notification permission, plus a request that must run from a user gesture. */
export function useBrowserNotificationPermission() {
  const [permission, setPermission] = useState(currentPermission)
  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    setPermission(await Notification.requestPermission())
  }, [])
  return { permission, request }
}

/** Mount once inside the router: shows browser-channel deliveries while permission is granted. */
export function useBrowserNotifications() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const depsRef = useRef({ t, navigate })
  useEffect(() => {
    depsRef.current = { t, navigate }
  })

  useEffect(() => eventBus.onBrowserNotification((data) => {
    if (currentPermission() !== 'granted') return
    const { t, navigate } = depsRef.current
    const { title, ...options } = toBrowserNotification(data, t)
    const shown = new Notification(title, options)
    shown.onclick = () => {
      window.focus()
      shown.close()
      if (data.messageId) {
        useMessagesStore.getState().open()
      } else if (data.projectId && data.issueId) {
        void navigate(`/projects/${data.projectId}/issues/${data.issueId}`)
      }
    }
  }), [])
}

import type { LucideIcon } from 'lucide-react'
import { Clock, Eye, History, MessageCircleQuestionMark } from 'lucide-react'

/**
 * Routed pages every global menu links to. Defined once so the desktop rail,
 * the mobile sheet and the home-page menus cannot drift apart.
 */
export interface GlobalPage {
  id: 'decisions' | 'review' | 'cron' | 'sessions'
  path: string
  icon: LucideIcon
  labelKey: string
}

export const GLOBAL_PAGES: readonly GlobalPage[] = [
  { id: 'decisions', path: '/decisions', icon: MessageCircleQuestionMark, labelKey: 'decisions.title' },
  { id: 'review', path: '/review', icon: Eye, labelKey: 'viewMode.review' },
  { id: 'cron', path: '/cron', icon: Clock, labelKey: 'cron.title' },
  { id: 'sessions', path: '/sessions', icon: History, labelKey: 'sessions.title' },
]

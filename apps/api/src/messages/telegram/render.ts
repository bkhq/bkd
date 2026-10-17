import type { DecisionEventOption, Message, MessageLevel } from '@bkd/shared'

/** Telegram's limit on message text, counted after entities are parsed. */
const TEXT_LIMIT = 4096

export type Callback
  = | { action: 'pick', eventId: string, index: number, version: string }
    | { action: 'confirm', eventId: string, index: number, version: string }
    | { action: 'back', eventId: string }
    | { action: 'close', eventId: string }
    | { action: 'confirm-close', eventId: string }

/** What the keyboard is asking the user to confirm. */
export type Pending = { index: number } | 'close'

export interface InlineButton {
  text: string
  callback_data: string
}

export interface RenderedEvent {
  text: string
  reply_markup: { inline_keyboard: InlineButton[][] }
}

/** Changes whenever the option list does, so a stale button cannot pick by index. */
export function optionsVersion(options: DecisionEventOption[]): string {
  return Bun.hash(options.map(o => o.id).join('\n')).toString(36).slice(0, 8)
}

export function parseCallback(data: string): Callback | null {
  const [code, eventId, index, version] = data.split(':')
  if (!eventId) return null
  if (code === 'b') return { action: 'back', eventId }
  if (code === 'x') return { action: 'close', eventId }
  if (code === 'y') return { action: 'confirm-close', eventId }
  if ((code === 'd' || code === 'c') && index && /^\d+$/.test(index) && version) {
    return { action: code === 'd' ? 'pick' : 'confirm', eventId, index: Number(index), version }
  }
  return null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function clip(s: string, max: number): string {
  if (max <= 0) return ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot);/g, '_').length
}

function optionLine(option: DecisionEventOption, labelMax: number): string {
  return `<b>${esc(clip(option.id, 50))}</b> — ${esc(clip(option.label, labelMax))}`
}

interface Limits {
  question: number
  context: number
  label: number
  impact: number
  extras: boolean
}

const LEVEL_ICONS: Record<MessageLevel, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
}

// Tried in order until the message fits.
const LIMIT_TIERS: Limits[] = [
  { question: 1000, context: 1500, label: 200, impact: 300, extras: true },
  { question: 1000, context: 300, label: 120, impact: 80, extras: true },
  { question: 1000, context: 0, label: 60, impact: 0, extras: true },
  { question: 600, context: 0, label: 60, impact: 0, extras: false },
]

function outcomeLines(event: Message): string[] {
  const lines: string[] = []
  const { decision, reply } = event
  if (reply) {
    lines.push(`💬 <b>Replied</b>: ${esc(clip(reply.text, 500))}`)
    lines.push(`By ${esc(clip(reply.repliedBy, 100))}`)
  }
  if (decision) {
    const option = event.options.find(o => o.id === decision.optionId)
    lines.push(`✅ <b>Decided</b>: ${option ? optionLine(option, 60) : 'answered in their own words'}`)
    if (decision.instruction) lines.push(`💬 ${esc(clip(decision.instruction, 500))}`)
    lines.push(`By ${esc(clip(decision.decidedBy, 100))}`)
  }
  if (event.status === 'applied' && event.outcome) lines.push(`Outcome: ${esc(clip(event.outcome, 300))}`)
  if (event.status === 'withdrawn') {
    lines.push(`↩️ <b>Withdrawn</b>${event.withdrawReason ? `: ${esc(clip(event.withdrawReason, 300))}` : ''}`)
  }
  if (event.status === 'closed') {
    lines.push(`🚫 <b>Closed</b>${event.closeReason ? `: ${esc(clip(event.closeReason, 300))}` : ''}`)
  }
  return lines
}

function renderText(event: Message, inboxUrl: string | null, limits: Limits, interactive: boolean): string {
  const icon = event.kind === 'decision' ? '❓' : LEVEL_ICONS[event.level]
  const lines = [`${icon} <b>${esc(clip(event.title, limits.question))}</b>`]

  const about = [
    event.links.projectName && `Project: ${esc(clip(event.links.projectName, 80))}`,
    event.links.ref && `#${event.links.ref.issueNumber} ${esc(clip(event.links.ref.title, 80))}`,
    event.kind === 'notification' && event.links.source
    && `From #${event.links.source.issueNumber} ${esc(clip(event.links.source.title, 80))}`,
  ].filter(Boolean)
  if (about.length > 0) lines.push(about.join(' · '))

  const context = clip(event.body, limits.context)
  if (context) lines.push('', esc(context))

  if (event.options.length > 0) lines.push('')
  for (const option of event.options) {
    const recommended = event.recommendation?.optionId === option.id
    lines.push(`${optionLine(option, limits.label)}${recommended ? ' ⭐' : ''}`)
    const impact = clip(option.impact, limits.impact)
    if (impact) lines.push(`    ${esc(impact)}`)
  }

  if (limits.extras) {
    const extras = [
      event.recommendation && `Recommended: ${esc(clip(`${event.recommendation.optionId} — ${event.recommendation.reason}`, 300))}`,
      event.blocks && `Blocks: ${esc(clip(event.blocks, 300))}`,
      event.continues && `Continues: ${esc(clip(event.continues, 300))}`,
    ].filter(Boolean) as string[]
    if (extras.length > 0) lines.push('', ...extras)
  }

  let tail = outcomeLines(event)
  if (event.status === 'open') {
    if (interactive) {
      tail = [event.kind === 'decision'
        ? 'Reply to this message to answer in your own words.'
        : 'Reply to this message to answer.']
    } else {
      tail = event.kind === 'decision' ? [] : ['💬 Awaiting a reply in the inbox.']
    }
  }
  if (tail.length > 0) lines.push('', ...tail)
  if (inboxUrl) lines.push(`🔗 <a href="${esc(inboxUrl)}">Open the inbox</a>`)

  return lines.join('\n')
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

function renderKeyboard(event: Message, pending?: Pending): InlineButton[][] {
  if (event.status !== 'open') return []
  const back = { text: 'Back', callback_data: `b:${event.id}` }

  if (pending === 'close') {
    return [[{ text: 'Confirm close', callback_data: `y:${event.id}` }, back]]
  }
  const version = optionsVersion(event.options)
  if (pending) {
    const option = event.options[pending.index]!
    return [[
      { text: `Confirm ${clip(option.id, 24)}`, callback_data: `c:${event.id}:${pending.index}:${version}` },
      back,
    ]]
  }

  const buttons = event.options.map((option, index) => ({
    text: `${clip(option.id, 24)}${event.recommendation?.optionId === option.id ? ' ⭐' : ''}`,
    callback_data: `d:${event.id}:${index}:${version}`,
  }))
  const perRow = buttons.every(b => b.text.length <= 8) ? 4 : 1
  return [...chunk(buttons, perRow), [{ text: 'Close', callback_data: `x:${event.id}` }]]
}

function fitText(event: Message, inboxUrl: string | null, interactive: boolean): string {
  let text = ''
  for (const limits of LIMIT_TIERS) {
    text = renderText(event, inboxUrl, limits, interactive)
    if (visibleLength(text) <= TEXT_LIMIT) break
  }
  return text
}

/** The message as a chat message that can be answered with its buttons or a reply. */
export function renderEvent(
  event: Message,
  inboxUrl: string | null,
  pending?: Pending,
): RenderedEvent {
  return {
    text: fitText(event, inboxUrl, true),
    reply_markup: { inline_keyboard: renderKeyboard(event, pending) },
  }
}

/** The message as a one-way chat message. */
export function renderNotification(event: Message, inboxUrl: string | null): string {
  return fitText(event, inboxUrl, false)
}

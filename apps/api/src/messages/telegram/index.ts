import type { Message } from '@bkd/shared'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { getServerUrl } from '@/db/helpers'
import { messageChannelMessages, webhooks } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { decideMessage, findMessage, replyMessage, serializeMessage, transition } from '@/messages/service'
import type { TelegramUpdate, TelegramUser } from './client'
import * as tg from './client'
import type { Pending } from './render'
import { optionsVersion, parseCallback, renderEvent } from './render'

interface Channel {
  id: string
  token: string
  chatId: string
}

async function loadChannels(): Promise<Channel[]> {
  const rows = await db
    .select({ id: webhooks.id, token: webhooks.secret, chatId: webhooks.url })
    .from(webhooks)
    .where(and(
      eq(webhooks.channel, 'telegram'),
      eq(webhooks.interactive, true),
      eq(webhooks.isActive, true),
      eq(webhooks.isDeleted, 0),
    ))
  return rows.flatMap(r => (r.token ? [{ id: r.id, token: r.token, chatId: r.chatId.trim() }] : []))
}

async function inboxUrl(): Promise<string | null> {
  const serverUrl = await getServerUrl()
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/messages` : null
}

/** A message the chat can answer: a decision or a notification awaiting a reply. */
async function loadEvent(eventId: string): Promise<Message | null> {
  const row = await findMessage(eventId)
  return row && row.expects === 'reply' ? serializeMessage(row) : null
}

async function draw(channel: Channel, event: Message, messageId: number, pending?: Pending) {
  const res = await tg.editMessageText(channel.token, {
    chat_id: channel.chatId,
    message_id: messageId,
    ...renderEvent(event, await inboxUrl(), pending),
  })
  // Redrawing an unchanged message is a 400 from Telegram, not a failure.
  if (!res.ok && !res.description?.includes('not modified')) {
    logger.warn({ eventId: event.id, status: res.status, description: res.description }, 'message_telegram_edit_failed')
  }
}

/** Bring every interactive chat in line with the message: post it while open, redraw it afterwards. */
export async function syncEvent(eventId: string): Promise<void> {
  const channels = await loadChannels()
  if (channels.length === 0) return
  const event = await loadEvent(eventId)
  if (!event) return

  for (const channel of channels) {
    try {
      const [message] = await db
        .select({ chatMessageId: messageChannelMessages.chatMessageId })
        .from(messageChannelMessages)
        .where(and(
          eq(messageChannelMessages.webhookId, channel.id),
          eq(messageChannelMessages.messageId, eventId),
        ))
      if (message) {
        await draw(channel, event, message.chatMessageId)
      } else if (event.status === 'open') {
        const sent = await tg.sendMessage(channel.token, {
          chat_id: channel.chatId,
          ...renderEvent(event, await inboxUrl()),
        })
        if (!sent.ok || !sent.result) {
          logger.warn({ eventId, status: sent.status, description: sent.description }, 'message_telegram_send_failed')
          continue
        }
        await db.insert(messageChannelMessages).values({
          webhookId: channel.id,
          messageId: eventId,
          chatId: channel.chatId,
          chatMessageId: sent.result.message_id,
        })
      }
    } catch (err) {
      logger.warn({ eventId, webhookId: channel.id, error: redact(err, channel.token) }, 'message_telegram_sync_failed')
    }
  }
}

function redact(err: unknown, token: string): string {
  return (err instanceof Error ? err.message : String(err)).replaceAll(token, '***')
}

function decidedBy(user: TelegramUser | undefined): string {
  return `telegram:${user?.username ?? user?.id ?? 'unknown'}`
}

/** The message a chat message carries, or null when it is not one of ours. */
async function eventIdOfMessage(channel: Channel, messageId: number): Promise<string | null> {
  const [row] = await db
    .select({ messageId: messageChannelMessages.messageId })
    .from(messageChannelMessages)
    .where(and(
      eq(messageChannelMessages.webhookId, channel.id),
      eq(messageChannelMessages.chatId, channel.chatId),
      eq(messageChannelMessages.chatMessageId, messageId),
    ))
  return row?.messageId ?? null
}

const NOT_WOKEN = 'Answered, but the agent could not be woken. Resend from the inbox.'

async function handleCallback(channels: Channel[], query: NonNullable<TelegramUpdate['callback_query']>) {
  const { message } = query
  const channel = message && channels.find(c => c.chatId === String(message.chat.id))
  if (!message || !channel) return

  const answer = (text?: string, alert = false) => tg.answerCallbackQuery(channel.token, query.id, text, alert)
  const callback = parseCallback(query.data ?? '')
  if (!callback || (await eventIdOfMessage(channel, message.message_id)) !== callback.eventId) {
    await answer('This button is no longer valid.')
    return
  }
  const event = await loadEvent(callback.eventId)
  if (!event) {
    await answer('This message no longer exists.')
    return
  }
  if (event.status !== 'open') {
    await answer(`This message is already ${event.status}.`)
    await draw(channel, event, message.message_id)
    return
  }
  const redraw = (pending?: Pending) => draw(channel, event, message.message_id, pending)

  if (callback.action === 'back') {
    await redraw()
    await answer()
    return
  }
  if (callback.action === 'close') {
    await redraw('close')
    await answer()
    return
  }
  if (callback.action === 'confirm-close') {
    const by = decidedBy(query.from)
    const result = await transition(event.id, ['open'], { status: 'closed', closeReason: `Closed by ${by}` })
    await answer('row' in result ? 'Closed.' : `This message is already ${result.blockedBy ?? 'gone'}.`)
    return
  }

  const option = event.options[callback.index]
  if (!option || callback.version !== optionsVersion(event.options)) {
    await answer('The options changed. Check them again.')
    await redraw()
    return
  }
  if (callback.action === 'pick') {
    await redraw({ index: callback.index })
    await answer()
    return
  }

  const result = await decideMessage(event.id, {
    optionId: option.id,
    instruction: '',
    decidedBy: decidedBy(query.from),
  })
  if (!result.ok) {
    await answer(result.reason === 'conflict' ? `This message is already ${result.status}.` : 'This decision could not be recorded.')
    await syncEvent(event.id)
  } else if (result.notified) {
    await answer(`Decided: ${option.id}`)
  } else {
    await answer(NOT_WOKEN, true)
  }
}

async function handleReply(channels: Channel[], message: NonNullable<TelegramUpdate['message']>) {
  const instruction = message.text?.trim()
  if (!instruction || !message.reply_to_message || message.from?.is_bot) return
  const channel = channels.find(c => c.chatId === String(message.chat.id))
  if (!channel) return
  const eventId = await eventIdOfMessage(channel, message.reply_to_message.message_id)
  if (!eventId) return
  const event = await findMessage(eventId)

  const by = decidedBy(message.from)
  const result = event?.kind === 'notification'
    ? await replyMessage(eventId, { text: instruction, repliedBy: by })
    : await decideMessage(eventId, { optionId: null, instruction, decidedBy: by })
  let text = event?.kind === 'notification' ? '✅ Reply recorded.' : '✅ Decision recorded.'
  if (!result.ok) text = result.reason === 'conflict' ? `This message is already ${result.status}.` : 'This message no longer exists.'
  else if (!result.notified) text = `⚠️ ${NOT_WOKEN}`
  await tg.sendMessage(channel.token, {
    chat_id: channel.chatId,
    text,
    reply_to_message_id: message.message_id,
  })
}

/** Process one update from the bot with this token. Updates from unconfigured chats are dropped. */
export async function handleUpdate(token: string, update: TelegramUpdate): Promise<void> {
  const channels = (await loadChannels()).filter(c => c.token === token)
  if (update.callback_query) await handleCallback(channels, update.callback_query)
  else if (update.message) await handleReply(channels, update.message)
}

// ── Long polling ────────────────────────────────────────

const MAX_BACKOFF_MS = 60_000
// Another consumer holds the bot (a second poller, or a webhook is set).
const CONFLICT_BACKOFF_MS = 30_000

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

async function poll(token: string, signal: AbortSignal): Promise<void> {
  let offset = 0
  let backoff = 0
  while (!signal.aborted) {
    try {
      const res = await tg.getUpdates(token, offset, signal)
      if (!res.ok) {
        backoff = res.status === 409 ? CONFLICT_BACKOFF_MS : Math.min(backoff * 2 || 1000, MAX_BACKOFF_MS)
        logger.warn({ status: res.status, description: res.description, backoff }, 'message_telegram_poll_rejected')
      } else {
        backoff = 0
        for (const update of res.result ?? []) {
          offset = update.update_id + 1
          await handleUpdate(token, update).catch((err) => {
            logger.warn({ error: redact(err, token) }, 'message_telegram_update_failed')
          })
        }
      }
    } catch (err) {
      if (signal.aborted) break
      backoff = Math.min(backoff * 2 || 1000, MAX_BACKOFF_MS)
      logger.warn({ error: redact(err, token), backoff }, 'message_telegram_poll_failed')
    }
    if (backoff > 0) await sleep(backoff, signal)
  }
}

let started = false
const pollers = new Map<string, AbortController>()

/** Match the running pollers to the configured interactive channels: one per bot token. */
export async function reloadMessageTelegram(): Promise<void> {
  if (!started) return
  const tokens = new Set((await loadChannels()).map(c => c.token))
  for (const [token, controller] of pollers) {
    if (tokens.has(token)) continue
    controller.abort()
    pollers.delete(token)
  }
  for (const token of tokens) {
    if (pollers.has(token)) continue
    const controller = new AbortController()
    pollers.set(token, controller)
    void poll(token, controller.signal)
  }
}

/** Subscribe to messages awaiting a reply and start polling. Returns the stop function. */
export function startMessageTelegram(): () => void {
  started = true
  let queue = Promise.resolve()
  const unsubscribe = appEvents.on(
    'message-updated',
    (data) => {
      if (data.expects !== 'reply') return
      // One at a time, so two quick updates cannot both post the message.
      queue = queue.then(() => syncEvent(data.id)).catch((err) => {
        logger.warn({ err, eventId: data.id }, 'message_telegram_sync_error')
      })
    },
    { order: 200 },
  )
  void reloadMessageTelegram().catch((err) => {
    logger.warn({ err }, 'message_telegram_start_failed')
  })

  return () => {
    started = false
    unsubscribe()
    for (const controller of pollers.values()) controller.abort()
    pollers.clear()
  }
}

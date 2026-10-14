const API = 'https://api.telegram.org'

export interface TelegramUser {
  id: number
  is_bot: boolean
  username?: string
}

export interface TelegramUpdate {
  update_id: number
  callback_query?: {
    id: string
    from: TelegramUser
    message?: { message_id: number, chat: { id: number } }
    data?: string
  }
  message?: {
    message_id: number
    from?: TelegramUser
    chat: { id: number }
    text?: string
    reply_to_message?: { message_id: number }
  }
}

export interface TelegramResult<T> {
  ok: boolean
  status: number
  result?: T
  description?: string
}

async function call<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  signal: AbortSignal = AbortSignal.timeout(10_000),
): Promise<TelegramResult<T>> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean, result?: T, description?: string }
    | null
  return {
    ok: res.ok && json?.ok === true,
    status: res.status,
    result: json?.result,
    description: json?.description,
  }
}

export function sendMessage(token: string, body: Record<string, unknown>) {
  return call<{ message_id: number }>(token, 'sendMessage', { parse_mode: 'HTML', ...body })
}

export function editMessageText(token: string, body: Record<string, unknown>) {
  return call<unknown>(token, 'editMessageText', { parse_mode: 'HTML', ...body })
}

export function answerCallbackQuery(token: string, id: string, text?: string, alert = false) {
  return call<boolean>(token, 'answerCallbackQuery', {
    callback_query_id: id,
    ...(text && { text, show_alert: alert }),
  })
}

const POLL_SECONDS = 50

/** Long-poll for updates; resolves early when one arrives. */
export function getUpdates(token: string, offset: number, signal: AbortSignal) {
  return call<TelegramUpdate[]>(
    token,
    'getUpdates',
    { offset, timeout: POLL_SECONDS, allowed_updates: ['callback_query', 'message'] },
    AbortSignal.any([signal, AbortSignal.timeout((POLL_SECONDS + 10) * 1000)]),
  )
}

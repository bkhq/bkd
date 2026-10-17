import type { Message } from '@bkd/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'

const messageKeys = {
  all: ['messages'] as const,
}

/** Every message, kept fresh by the server's `message-updated` signal. */
export function useMessages() {
  const qc = useQueryClient()
  useEffect(
    () => eventBus.onMessageUpdated(() => {
      void qc.invalidateQueries({ queryKey: messageKeys.all })
    }),
    [qc],
  )
  return useQuery({
    queryKey: messageKeys.all,
    queryFn: kanbanApi.getMessages,
  })
}

/** Open decisions and replies, plus notifications not read yet. */
export function isWaitingOnUser(message: Message): boolean {
  return message.status === 'open' || message.status === 'unread'
}

/** Number of messages waiting on the user. */
export function useWaitingMessageCount(): number {
  const { data } = useMessages()
  return data?.filter(isWaitingOnUser).length ?? 0
}

function useMessageMutation<T>(mutationFn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSettled: () => qc.invalidateQueries({ queryKey: messageKeys.all }),
  })
}

export function useDecideMessage() {
  return useMessageMutation(({ id, ...data }: { id: string, optionId?: string | null, instruction?: string }) =>
    kanbanApi.decideMessage(id, data))
}

export function useReplyMessage() {
  return useMessageMutation(({ id, text }: { id: string, text: string }) => kanbanApi.replyMessage(id, text))
}

export function useCloseMessage() {
  return useMessageMutation(({ id, reason }: { id: string, reason?: string }) => kanbanApi.closeMessage(id, reason))
}

export function useNotifyMessage() {
  return useMessageMutation((id: string) => kanbanApi.notifyMessage(id))
}

export function useReadMessage() {
  return useMessageMutation((id: string) => kanbanApi.readMessage(id))
}

export function useReadAllMessages() {
  return useMessageMutation((_: void) => kanbanApi.readAllMessages())
}

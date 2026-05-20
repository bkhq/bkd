import type {
  CockpitTimelineMessage,
  CockpitTimelineMessageKind,
} from '@bkd/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryKeys } from '@/hooks/use-kanban'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'

export interface TimelineSnapshot {
  messages: CockpitTimelineMessage[]
  counts: Record<CockpitTimelineMessageKind, number>
}

/**
 * Apply a single SSE delta to the cached snapshot — upsert by id,
 * cap the in-memory window at 200, recompute open-bucket counts.
 * Exported for unit testing.
 */
export function patchSnapshot(prev: TimelineSnapshot | undefined, next: CockpitTimelineMessage): TimelineSnapshot {
  const base = prev ?? {
    messages: [],
    counts: {
      suggest_merge: 0,
      alert_off_track: 0,
      suggest_reply: 0,
      alert_repeat_fail: 0,
      alert_stale_working: 0,
      ack: 0,
      info: 0,
    },
  }
  const idx = base.messages.findIndex(m => m.id === next.id)
  let messages: CockpitTimelineMessage[]
  if (idx >= 0) {
    messages = [...base.messages]
    messages[idx] = next
  } else {
    messages = [next, ...base.messages].slice(0, 200)
  }
  // Recompute counts from current open messages.
  const counts: Record<CockpitTimelineMessageKind, number> = {
    suggest_merge: 0,
    alert_off_track: 0,
    suggest_reply: 0,
    alert_repeat_fail: 0,
    alert_stale_working: 0,
    ack: 0,
    info: 0,
  }
  for (const m of messages) {
    if (m.status === 'open') counts[m.kind]++
  }
  return { messages, counts }
}

export function useCockpitTimeline() {
  const qc = useQueryClient()

  useEffect(() => {
    return eventBus.onCockpitTimeline((delta) => {
      qc.setQueryData<TimelineSnapshot>(queryKeys.cockpitTimeline(), prev =>
        patchSnapshot(prev, delta.message))
    })
  }, [qc])

  return useQuery({
    queryKey: queryKeys.cockpitTimeline(),
    queryFn: () => kanbanApi.listCockpitTimeline({ limit: 100 }),
    staleTime: 10_000,
  })
}

export function useAckCockpitTimeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.ackCockpitTimelineMessage(id),
    onSuccess: (msg) => {
      qc.setQueryData<TimelineSnapshot>(queryKeys.cockpitTimeline(), prev =>
        patchSnapshot(prev, msg))
    },
  })
}

export function useDismissCockpitTimeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => kanbanApi.dismissCockpitTimelineMessage(id),
    onSuccess: (msg) => {
      qc.setQueryData<TimelineSnapshot>(queryKeys.cockpitTimeline(), prev =>
        patchSnapshot(prev, msg))
    },
  })
}

export function useSnoozeCockpitTimeline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, untilMs }: { id: string, untilMs: number }) =>
      kanbanApi.snoozeCockpitTimelineMessage(id, untilMs),
    onSuccess: (msg) => {
      qc.setQueryData<TimelineSnapshot>(queryKeys.cockpitTimeline(), prev =>
        patchSnapshot(prev, msg))
    },
  })
}

export function useExecuteCockpitAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ type, params }: { type: string, params: Record<string, unknown> }) =>
      kanbanApi.executeCockpitAction(type, params),
    onSettled: () => {
      qc.invalidateQueries({
        predicate: q => q.queryKey[0] === 'issues' || q.queryKey[0] === 'projects',
      })
    },
  })
}

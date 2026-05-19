import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { kanbanApi } from '@/lib/kanban-api'

export type BulkAction = 'restart' | 'cancel' | 'moveStatus'

export interface BulkItem {
  issueId: string
  projectId: string
}

export interface BulkProgress {
  total: number
  done: number
  failed: number
}

const CONCURRENCY = 5

async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  limit: number,
): Promise<{ done: number, failed: number }> {
  let done = 0
  let failed = 0
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++
      try {
        await fn(items[idx])
        done++
      } catch {
        failed++
      }
    }
  }
  // Spawn N independent worker loops that share the closed-over `cursor`.
  // (Note: do not use Array.from(...).fill(worker()) — that creates a SINGLE
  // promise reused N times and collapses parallelism to 1.)
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker())
  await Promise.all(workers)
  return { done, failed }
}

export function useBulkOperations() {
  const qc = useQueryClient()
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const run = useCallback(
    async (action: BulkAction, items: BulkItem[], opts?: { statusId?: string }) => {
      if (items.length === 0) return { done: 0, failed: 0 }
      setIsRunning(true)
      setProgress({ total: items.length, done: 0, failed: 0 })

      const fn = (item: BulkItem) => {
        if (action === 'restart') return kanbanApi.restartIssue(item.projectId, item.issueId)
        if (action === 'cancel') return kanbanApi.cancelIssue(item.projectId, item.issueId)
        if (action === 'moveStatus') {
          if (!opts?.statusId) throw new Error('statusId is required for moveStatus')
          return kanbanApi.updateIssue(item.projectId, item.issueId, { statusId: opts.statusId })
        }
        throw new Error(`Unknown action: ${action}`)
      }

      // Per-item progress (poll-style)
      let done = 0
      let failed = 0
      const wrapped = async (item: BulkItem) => {
        try {
          await fn(item)
          done++
        } catch {
          failed++
        } finally {
          setProgress({ total: items.length, done, failed })
        }
      }

      await runWithConcurrency(items, wrapped, CONCURRENCY)

      // Invalidate everything cockpit cares about
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({
        predicate: q => q.queryKey[0] === 'issues',
      })
      setIsRunning(false)
      return { done, failed }
    },
    [qc],
  )

  return { run, progress, isRunning }
}

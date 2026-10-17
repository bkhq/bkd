import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUploadStore } from '@/stores/upload-store'

describe('upload-store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUploadStore.setState({ uploads: [] })
  })
  afterEach(() => vi.useRealTimers())

  it('tracks an upload from start to removal', () => {
    const files = [new File(['abc'], 'a.txt'), new File(['de'], 'b.txt')]
    const id = useUploadStore.getState().start(files)
    expect(useUploadStore.getState().uploads).toEqual([
      { id, fileName: 'a.txt', fileCount: 2, loaded: 0, total: 5, status: 'uploading' },
    ])

    useUploadStore.getState().progress(id, 3, 5)
    expect(useUploadStore.getState().uploads[0]?.loaded).toBe(3)

    useUploadStore.getState().finish(id, 'done')
    expect(useUploadStore.getState().uploads[0]).toMatchObject({ loaded: 5, status: 'done' })

    vi.advanceTimersByTime(3000)
    expect(useUploadStore.getState().uploads).toEqual([])
  })

  it('keeps a failed upload visible until the dismiss delay passes', () => {
    const id = useUploadStore.getState().start([new File(['abc'], 'a.txt')])
    useUploadStore.getState().finish(id, 'error')
    expect(useUploadStore.getState().uploads[0]).toMatchObject({ loaded: 0, status: 'error' })
    vi.advanceTimersByTime(2999)
    expect(useUploadStore.getState().uploads).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useUploadStore.getState().uploads).toEqual([])
  })
})

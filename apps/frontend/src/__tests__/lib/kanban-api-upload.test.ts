import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kanbanApi } from '@/lib/kanban-api'

// ────────────────────────────────────────────────────────────────────────────
// Tests for the XHR-based multipart upload path used by followUpIssue.
//
// We replace `globalThis.XMLHttpRequest` with a controllable stub so we can
// (a) capture the request, (b) synthesise upload.progress events, and
// (c) drive the response lifecycle (load / error). jsdom's built-in XHR is
// network-bound; substituting a stub keeps the test deterministic.
// ────────────────────────────────────────────────────────────────────────────

interface FakeUpload {
  listeners: Map<string, Array<(e: ProgressEvent) => void>>
  emit: (loaded: number, total: number) => void
}

interface FakeXHR {
  method: string
  url: string
  headers: Record<string, string>
  body: FormData | null
  status: number
  responseText: string
  upload: FakeUpload
  onload: (() => void) | null
  onerror: (() => void) | null
  open: (m: string, u: string) => void
  setRequestHeader: (k: string, v: string) => void
  send: (body: FormData) => void
  abort: () => void
  finishOK: (json: unknown) => void
  finishError: () => void
}

function makeFakeXHR(): FakeXHR {
  const upload: FakeUpload = {
    listeners: new Map(),
    emit(loaded: number, total: number) {
      const cbs = upload.listeners.get('progress') ?? []
      const event = { loaded, total, lengthComputable: true } as unknown as ProgressEvent
      for (const cb of cbs) cb(event)
    },
  }
  const xhr: FakeXHR = {
    method: '',
    url: '',
    headers: {},
    body: null,
    status: 0,
    responseText: '',
    upload: Object.assign(upload, {
      addEventListener(type: string, cb: (e: ProgressEvent) => void) {
        const list = upload.listeners.get(type) ?? []
        list.push(cb)
        upload.listeners.set(type, list)
      },
    }) as FakeUpload,
    onload: null,
    onerror: null,
    open(m, u) {
      xhr.method = m
      xhr.url = u
    },
    setRequestHeader(k, v) {
      xhr.headers[k] = v
    },
    send(body) {
      xhr.body = body
    },
    abort: vi.fn(),
    finishOK(json: unknown) {
      xhr.status = 200
      xhr.responseText = JSON.stringify(json)
      xhr.onload?.()
    },
    finishError() {
      xhr.onerror?.()
    },
  }
  return xhr
}

let lastXHR: FakeXHR | null = null
const originalXHR = globalThis.XMLHttpRequest

beforeEach(() => {
  lastXHR = null
  ;(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
    function FakeXHRCtor() {
      const xhr = makeFakeXHR()
      lastXHR = xhr
      return xhr
    }
})

afterEach(() => {
  ;(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = originalXHR
})

describe('kanbanApi.followUpIssue (multipart with files)', () => {
  it('issues a POST with the multipart form body', async () => {
    const file = new File([new Uint8Array(8 * 1024 * 1024)], 'seed.zip', {
      type: 'application/zip',
    })
    const promise = kanbanApi.followUpIssue({
      projectId: 'p',
      issueId: 'i',
      prompt: 'init from this archive',
      files: [file],
    })

    // Allow the synchronous body of the helper to run and register the XHR.
    await Promise.resolve()
    expect(lastXHR).not.toBeNull()
    expect(lastXHR!.method).toBe('POST')
    expect(lastXHR!.url).toBe('/api/projects/p/issues/i/follow-up')
    expect(lastXHR!.body).toBeInstanceOf(FormData)

    lastXHR!.finishOK({
      success: true,
      data: { messageId: 'm-1', issueId: 'i', executionId: 'e-1' },
    })

    const result = await promise
    expect(result.messageId).toBe('m-1')
  })

  it('forwards upload progress events to the onUploadProgress callback', async () => {
    const file = new File([new Uint8Array(1024)], 'a.txt', { type: 'text/plain' })
    const progress: Array<{ loaded: number, total: number }> = []
    const promise = kanbanApi.followUpIssue({
      projectId: 'p',
      issueId: 'i',
      prompt: 'p',
      files: [file],
      onUploadProgress: e => progress.push(e),
    })

    await Promise.resolve()
    lastXHR!.upload.emit(256, 1024)
    lastXHR!.upload.emit(768, 1024)
    lastXHR!.upload.emit(1024, 1024)
    lastXHR!.finishOK({
      success: true,
      data: { messageId: 'm', issueId: 'i' },
    })
    await promise

    expect(progress).toEqual([
      { loaded: 256, total: 1024 },
      { loaded: 768, total: 1024 },
      { loaded: 1024, total: 1024 },
    ])
  })

  it('rejects with a network error when the XHR fails mid-upload', async () => {
    const file = new File([new Uint8Array(64)], 'small.bin', { type: 'application/octet-stream' })
    const promise = kanbanApi.followUpIssue({
      projectId: 'p',
      issueId: 'i',
      prompt: 'p',
      files: [file],
    })

    await Promise.resolve()
    lastXHR!.finishError()

    await expect(promise).rejects.toThrow(/Network error/)
  })

  it('rejects with the API error message when the server returns success=false', async () => {
    const file = new File([new Uint8Array(64)], 'small.bin', { type: 'application/octet-stream' })
    const promise = kanbanApi.followUpIssue({
      projectId: 'p',
      issueId: 'i',
      prompt: 'p',
      files: [file],
    })

    await Promise.resolve()
    lastXHR!.status = 400
    lastXHR!.responseText = JSON.stringify({ success: false, error: 'too big' })
    lastXHR!.onload?.()

    await expect(promise).rejects.toThrow('too big')
  })
})

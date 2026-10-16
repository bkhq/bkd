import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kanbanApi } from '../../lib/kanban-api'
import { useUploadStore } from '../../stores/upload-store'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockJsonResponse<T>(data: T, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ success: true, data }),
  }
}

function mockErrorResponse(error: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: false, error }),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('kanbanApi.getProjects', () => {
  it('calls GET /api/projects', async () => {
    const projects = [{ id: '1', name: 'Test' }]
    mockFetch.mockResolvedValueOnce(mockJsonResponse(projects))

    const result = await kanbanApi.getProjects()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(options?.method).toBeUndefined() // GET is default
    expect(result).toEqual(projects)
  })

  it('throws on API error response', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse('Not found'))

    await expect(kanbanApi.getProjects()).rejects.toThrow('Not found')
  })
})

describe('kanbanApi.createProject', () => {
  it('calls POST /api/projects with body', async () => {
    const project = { id: '1', name: 'New Project' }
    mockFetch.mockResolvedValueOnce(mockJsonResponse(project))

    const result = await kanbanApi.createProject({ name: 'New Project' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ name: 'New Project' })
    expect(result).toEqual(project)
  })
})

describe('kanbanApi.updateProject', () => {
  it('calls PATCH /api/projects/:id with body', async () => {
    const project = { id: 'abc', name: 'Updated' }
    mockFetch.mockResolvedValueOnce(mockJsonResponse(project))

    await kanbanApi.updateProject('abc', { name: 'Updated' })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/abc')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body as string)).toEqual({ name: 'Updated' })
  })
})

describe('kanbanApi.getIssues', () => {
  it('loads every page when the server bounds its default response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [{ id: 'first' }], hasMore: true, nextCursor: 'next-page' }),
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [{ id: 'second' }], hasMore: false, nextCursor: null }),
    })
    expect(await kanbanApi.getIssues('proj-1')).toEqual([{ id: 'first' }, { id: 'second' }])
    expect(mockFetch.mock.calls[1][0]).toBe('/api/projects/proj-1/issues?cursor=next-page')
  })
  it('calls GET /api/projects/:projectId/issues', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse([]))

    await kanbanApi.getIssues('proj-1')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/proj-1/issues')
  })
})

describe('kanbanApi.followUpIssue', () => {
  it('calls POST with JSON body when no files', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ issueId: 'issue-1' }))

    await kanbanApi.followUpIssue({
      projectId: 'proj-1',
      issueId: 'issue-1',
      prompt: 'Hello',
    })

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/projects/proj-1/issues/issue-1/follow-up')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body as string)
    expect(body.prompt).toBe('Hello')
  })
})

describe('kanbanApi.deleteCronJob', () => {
  it('calls DELETE /api/cron/:jobId', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ deleted: true, name: 'cleanup' }))

    const result = await kanbanApi.deleteCronJob('cron-1')

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/cron/cron-1')
    expect(options.method).toBe('DELETE')
    expect(result).toEqual({ deleted: true, name: 'cleanup' })
  })
})

describe('kanbanApi error handling', () => {
  it('throws when success is false', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse('Something went wrong'))

    await expect(kanbanApi.getProjects()).rejects.toThrow('Something went wrong')
  })
})

class FakeXhr {
  static instances: FakeXhr[] = []
  method = ''
  url = ''
  body: unknown = null
  status = 0
  responseText = ''
  upload: { onprogress: ((e: { lengthComputable: boolean, loaded: number, total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  abort = vi.fn(() => this.onabort?.())

  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: unknown) {
    this.body = body
  }

  respond(status: number, body: string) {
    this.status = status
    this.responseText = body
    this.onload?.()
  }
}

function lastXhr() {
  const xhr = FakeXhr.instances.at(-1)
  if (!xhr) throw new Error('no XMLHttpRequest sent')
  return xhr
}

describe('kanbanApi.uploadFiles', () => {
  beforeEach(() => {
    FakeXhr.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    useUploadStore.setState({ uploads: [] })
  })

  it('posts multipart form data to the encoded upload URL', async () => {
    const uploaded = [{ name: 'a.txt', size: 1 }]
    const file = new File(['a'], 'a.txt', { type: 'text/plain' })

    const promise = kanbanApi.uploadFiles('/ws/proj', 'src/lib', [file], true)
    const xhr = lastXhr()
    xhr.respond(201, JSON.stringify({ success: true, data: { uploaded } }))
    const result = await promise

    expect(xhr.url).toMatch(/^\/api\/files\/[1-9A-HJ-NP-Za-km-z]+\/upload\/src\/lib$/)
    expect(xhr.method).toBe('POST')
    const body = xhr.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.getAll('files')).toEqual([file])
    expect(body.get('overwrite')).toBe('true')
    expect(result.uploaded).toEqual(uploaded)
  })

  it('omits the path segment and overwrite flag at the root', async () => {
    const promise = kanbanApi.uploadFiles('/ws/proj', '.', [new File(['a'], 'a.txt')])
    const xhr = lastXhr()
    xhr.respond(201, JSON.stringify({ success: true, data: { uploaded: [] } }))
    await promise

    expect(xhr.url).toMatch(/^\/api\/files\/[1-9A-HJ-NP-Za-km-z]+\/upload$/)
    expect((xhr.body as FormData).get('overwrite')).toBeNull()
  })

  it('reports upload progress to the upload store', async () => {
    const promise = kanbanApi.uploadFiles('/ws/proj', '.', [new File(['abcd'], 'a.txt')])
    const xhr = lastXhr()
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 })
    expect(useUploadStore.getState().uploads[0]).toMatchObject({ fileName: 'a.txt', loaded: 2, total: 4, status: 'uploading' })

    xhr.respond(201, JSON.stringify({ success: true, data: { uploaded: [] } }))
    await promise
    expect(useUploadStore.getState().uploads[0]).toMatchObject({ loaded: 4, status: 'done' })
  })

  it('rejects with the server error and marks the upload failed', async () => {
    const promise = kanbanApi.uploadFiles('/ws/proj', '.', [new File(['a'], 'a.txt')])
    lastXhr().respond(409, JSON.stringify({ success: false, error: 'Already exists: a.txt' }))

    await expect(promise).rejects.toMatchObject({ message: 'Already exists: a.txt', statusCode: 409 })
    expect(useUploadStore.getState().uploads[0]?.status).toBe('error')
  })

  it('rejects a non-JSON response with its HTTP status', async () => {
    const promise = kanbanApi.uploadFiles('/ws/proj', '.', [new File(['a'], 'a.txt')])
    lastXhr().respond(413, 'Payload Too Large')

    await expect(promise).rejects.toMatchObject({ statusCode: 413 })
  })

  it('aborts only after the upload makes no progress for 60s', async () => {
    vi.useFakeTimers()
    try {
      const promise = kanbanApi.uploadFiles('/ws/proj', '.', [new File(['abcd'], 'a.txt')])
      const rejection = expect(promise).rejects.toMatchObject({ statusCode: 408 })
      const xhr = lastXhr()
      vi.advanceTimersByTime(59_000)
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 })
      vi.advanceTimersByTime(59_000)
      expect(xhr.abort).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1_000)
      expect(xhr.abort).toHaveBeenCalledTimes(1)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})

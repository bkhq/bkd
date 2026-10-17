import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_FILES, parseMultipartUpload, UploadError } from '@/uploads'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bkd-multipart-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function multipartRequest(fd: FormData): Request {
  return new Request('http://localhost/upload', { method: 'POST', body: fd })
}

function parse(request: Request, maxUploadSize?: number) {
  return parseMultipartUpload(request, { dir, storedName: id => `${id}.part`, maxUploadSize })
}

async function expectUploadError(promise: Promise<unknown>, status: number, message: string) {
  const error = await promise.then(() => null, (err: unknown) => err)
  expect(error).toBeInstanceOf(UploadError)
  expect(error).toMatchObject({ status, message })
}

describe('parseMultipartUpload', () => {
  test('streams file parts to disk and collects string fields', async () => {
    const fd = new FormData()
    fd.append('title', 'Hello')
    fd.append('files', new File(['first file'], 'a.txt', { type: 'text/plain' }))
    fd.append('files', new File([new Uint8Array([1, 2, 3])], 'b.bin'))
    fd.append('overwrite', 'true')

    const { fields, files } = await parse(multipartRequest(fd))

    expect(fields).toEqual([['title', 'Hello'], ['overwrite', 'true']])
    expect(files.map(f => [f.originalName, f.mimeType, f.size])).toEqual([
      ['a.txt', 'text/plain', 10],
      ['b.bin', 'application/octet-stream', 3],
    ])
    expect(readFileSync(files[0]!.absolutePath, 'utf8')).toBe('first file')
    expect([...readFileSync(files[1]!.absolutePath)]).toEqual([1, 2, 3])
    expect(files[0]!.storedName).toBe(`${files[0]!.id}.part`)
  })

  test('keeps client file names verbatim', async () => {
    const fd = new FormData()
    fd.append('files', new File(['x'], '../escape.txt'))
    const { files } = await parse(multipartRequest(fd))
    expect(files[0]?.originalName).toBe('../escape.txt')
  })

  test('discards file parts under other field names', async () => {
    const fd = new FormData()
    fd.append('other', new File(['x'], 'x.txt'))
    const { files } = await parse(multipartRequest(fd))
    expect(files).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  test('rejects an upload over the size limit and leaves no files', async () => {
    const fd = new FormData()
    fd.append('files', new File([new Uint8Array(600)], 'a.bin'))
    fd.append('files', new File([new Uint8Array(600)], 'b.bin'))
    await expectUploadError(parse(multipartRequest(fd), 1000), 413, 'Upload exceeds the size limit')
    expect(readdirSync(dir)).toEqual([])
  })

  test('rejects too many files and leaves no files', async () => {
    const fd = new FormData()
    for (let i = 0; i <= MAX_FILES; i++) fd.append('files', new File(['x'], `${i}.txt`))
    await expectUploadError(parse(multipartRequest(fd)), 400, `Too many files (max ${MAX_FILES})`)
    expect(readdirSync(dir)).toEqual([])
  })

  test('rejects a body that is not multipart', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    await expectUploadError(parse(request), 400, 'Invalid multipart body')
  })

  test('rejects a truncated multipart body and leaves no files', async () => {
    const boundary = 'bkdtestboundary'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\n`
      + `Content-Type: text/plain\r\n\r\npartial content without a closing boundary`
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
    await expectUploadError(parse(request), 400, 'Invalid multipart body')
    expect(readdirSync(dir)).toEqual([])
  })

  test('fails and leaves no files when the client disconnects mid-upload', async () => {
    let result: Promise<unknown> | undefined
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        result = parse(request).then(() => null, (err: unknown) => err)
        return result.then(() => new Response('done'))
      },
    })
    try {
      const boundary = 'bkdabortboundary'
      const head = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.bin"\r\n\r\n`
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(head))
          controller.enqueue(new Uint8Array(64 * 1024))
        },
      })
      const client = new AbortController()
      void fetch(`http://127.0.0.1:${server.port}/`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body,
        signal: client.signal,
      }).catch(() => {})
      for (let i = 0; i < 100 && readdirSync(dir).length === 0; i++) await Bun.sleep(10)
      expect(readdirSync(dir)).toHaveLength(1)

      client.abort()
      const error = await result
      expect(error).toBeInstanceOf(UploadError)
      expect(error).toMatchObject({ status: 400, message: 'Upload aborted' })
      expect(readdirSync(dir)).toEqual([])
    } finally {
      server.stop(true)
    }
  })

  test('rejects a field value over the field size limit', async () => {
    const fd = new FormData()
    fd.append('prompt', 'x'.repeat(1024 * 1024 + 1))
    await expectUploadError(parse(multipartRequest(fd)), 400, 'Field "prompt" is too large')
  })
})

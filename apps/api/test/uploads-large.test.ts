import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

// Allocating MAX_FILE_SIZE (100 MB) inside the unit test would dominate
// runtime and memory; we exercise the streaming-write contract with a
// representative mid-sized file (well above the legacy 10 MB cap, well
// below the new 100 MB ceiling) and verify the size guard at the
// boundary with cheap synthetic Files that report large `.size` without
// allocating bytes.

const ORIGINAL_CWD = process.cwd()
let scratchDir: string

beforeAll(async () => {
  scratchDir = await mkdtemp(resolve(tmpdir(), 'bkd-uploads-large-'))
  process.chdir(scratchDir)
})

afterAll(async () => {
  process.chdir(ORIGINAL_CWD)
  await rm(scratchDir, { recursive: true, force: true })
})

describe('uploads.ts — raised attachment ceiling', () => {
  it('exposes a 100 MB MAX_FILE_SIZE so project tarballs fit', async () => {
    const { MAX_FILE_SIZE } = await import('../src/uploads')
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024)
  })

  it('keeps MAX_FILES at 10', async () => {
    const { MAX_FILES } = await import('../src/uploads')
    expect(MAX_FILES).toBe(10)
  })

  it('validateFiles accepts files just under the ceiling', async () => {
    const { validateFiles, MAX_FILE_SIZE } = await import('../src/uploads')
    // Synthetic File-like payload — File.size is whatever we hand it,
    // no actual bytes allocated. Validates the boundary without
    // allocating MAX_FILE_SIZE bytes.
    const justUnder = new File([new Uint8Array(0)], 'big.zip', {
      type: 'application/zip',
    })
    Object.defineProperty(justUnder, 'size', { value: MAX_FILE_SIZE - 1 })
    const result = validateFiles([justUnder])
    expect(result.ok).toBe(true)
  })

  it('validateFiles rejects files just over the ceiling with a clear message', async () => {
    const { validateFiles, MAX_FILE_SIZE } = await import('../src/uploads')
    const justOver = new File([new Uint8Array(0)], 'too-big.zip', {
      type: 'application/zip',
    })
    Object.defineProperty(justOver, 'size', { value: MAX_FILE_SIZE + 1 })
    const result = validateFiles([justOver])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Surface the configured limit in MB so users know the ceiling.
      expect(result.error).toMatch(/100MB/)
      expect(result.error).toMatch(/too-big\.zip/)
    }
  })

  it('saveUploadedFile streams a 15 MB payload to disk with byte-exact size', async () => {
    const { saveUploadedFile } = await import('../src/uploads')
    // 15 MB exercises the path that previously would have been rejected
    // outright; small enough that the test runs in well under a second
    // but large enough that Bun routes the File through its temp-file
    // streaming path rather than the inline buffer.
    const payloadSize = 15 * 1024 * 1024
    const bytes = new Uint8Array(payloadSize)
    // Fill a few sentinel bytes so we know the file is not all-zeros by
    // accident in the read-back below.
    bytes[0] = 0xDE
    bytes[1] = 0xAD
    bytes[payloadSize - 2] = 0xBE
    bytes[payloadSize - 1] = 0xEF
    const file = new File([bytes], 'project.zip', { type: 'application/zip' })

    const saved = await saveUploadedFile(file)

    expect(saved.size).toBe(payloadSize)
    expect(saved.originalName).toBe('project.zip')
    expect(saved.mimeType).toBe('application/zip')

    const onDisk = Bun.file(saved.absolutePath)
    expect(await onDisk.exists()).toBe(true)
    expect(onDisk.size).toBe(payloadSize)

    // Confirm sentinels round-tripped — proves the stream wrote the
    // whole file, not just the head or tail.
    const buf = new Uint8Array(await onDisk.arrayBuffer())
    expect(buf[0]).toBe(0xDE)
    expect(buf[1]).toBe(0xAD)
    expect(buf[payloadSize - 2]).toBe(0xBE)
    expect(buf[payloadSize - 1]).toBe(0xEF)
  })
})

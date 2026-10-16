import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFileAttachments } from '@/hooks/use-file-attachments'
import '@/i18n'

function fakeFile(name: string, size: number): File {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('useFileAttachments', () => {
  it('accepts a file over 10 MB', () => {
    const { result } = renderHook(() => useFileAttachments())
    act(() => result.current.addFiles([fakeFile('big.bin', 500 * 1024 * 1024)]))
    expect(result.current.attachedFiles.map(f => f.name)).toEqual(['big.bin'])
    expect(result.current.attachError).toBeNull()
  })

  it('skips a file that would push the total over 1 GB', () => {
    const { result } = renderHook(() => useFileAttachments())
    act(() => result.current.addFiles([
      fakeFile('a.bin', 600 * 1024 * 1024),
      fakeFile('b.bin', 600 * 1024 * 1024),
      fakeFile('c.txt', 1024),
    ]))
    expect(result.current.attachedFiles.map(f => f.name)).toEqual(['a.bin', 'c.txt'])
    expect(result.current.attachError).toContain('b.bin')
  })
})

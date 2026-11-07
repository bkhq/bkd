import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
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

function DropTarget({ onFiles }: { onFiles: (names: string[]) => void }) {
  const attach = useFileAttachments()
  onFiles(attach.attachedFiles.map(f => f.name))
  return (
    <div data-testid="target" {...attach.getRootProps()}>
      <input data-testid="input" {...attach.getInputProps()} />
      {attach.isDragOver ? 'dragging' : 'idle'}
    </div>
  )
}

describe('useFileAttachments drop zone', () => {
  it('attaches dropped files', async () => {
    let names: string[] = []
    render(
      <DropTarget onFiles={(n) => {
        names = n
      }}
      />,
    )
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.drop(screen.getByTestId('target'), {
      dataTransfer: { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], types: ['Files'] },
    })
    await waitFor(() => expect(names).toEqual(['shot.png']))
  })

  it('attaches files picked through the input', async () => {
    let names: string[] = []
    render(
      <DropTarget onFiles={(n) => {
        names = n
      }}
      />,
    )
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('input'), { target: { files: [file] } })
    await waitFor(() => expect(names).toEqual(['notes.txt']))
  })
})

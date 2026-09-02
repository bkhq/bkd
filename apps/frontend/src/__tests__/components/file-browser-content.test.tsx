import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { FileBrowserContent } from '@/components/files/FileBrowserContent'
import { ApiError } from '@/lib/kanban-api'
import { useFileBrowserStore } from '@/stores/file-browser-store'

const mocks = vi.hoisted(() => ({
  uploadMutate: vi.fn(),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useProject: () => ({ data: { id: 'p1', name: 'Proj', directory: '/ws/proj' } }),
  useProjectFiles: () => ({
    data: { path: 'src', type: 'directory', entries: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useDeleteFile: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveFile: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadFiles: () => ({ mutate: mocks.uploadMutate, isPending: false }),
}))

// FileViewer pulls in the Shiki bundle; the upload flow never renders it.
vi.mock('@/components/files/FileViewer', () => ({ FileViewer: () => null }))

function renderBrowser() {
  useFileBrowserStore.setState({
    projectId: 'p1',
    issueId: null,
    rootPath: null,
    currentPath: 'src',
    isOpen: true,
  })
  return render(<FileBrowserContent />)
}

function pickFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

describe('file browser upload', () => {
  beforeEach(async () => {
    mocks.uploadMutate.mockReset()
    await i18n.changeLanguage('en')
  })

  it('uploads picked files into the current directory', () => {
    const { container } = renderBrowser()
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    expect(screen.getByRole('button', { name: 'Upload files' })).toBeInTheDocument()
    pickFiles(container, [file])

    expect(mocks.uploadMutate).toHaveBeenCalledWith(
      { root: '/ws/proj', path: 'src', files: [file], overwrite: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('shows a drop hint while dragging and uploads dropped files', () => {
    renderBrowser()
    const file = new File(['x'], 'dropped.txt')
    const zone = screen.getByText('Empty directory')

    fireEvent.dragOver(zone, { dataTransfer: { files: [file] } })
    expect(screen.getByText('Drop files to upload here')).toBeInTheDocument()

    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(screen.queryByText('Drop files to upload here')).not.toBeInTheDocument()
    expect(mocks.uploadMutate).toHaveBeenCalledWith(
      { root: '/ws/proj', path: 'src', files: [file], overwrite: false },
      expect.anything(),
    )
  })

  it('asks before replacing existing files and retries with overwrite', () => {
    mocks.uploadMutate.mockImplementationOnce((_vars, opts) => {
      opts?.onError?.(new ApiError('Already exists: hello.txt', 409))
    })
    const { container } = renderBrowser()
    const file = new File(['hello'], 'hello.txt')

    pickFiles(container, [file])

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/hello\.txt/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))

    expect(mocks.uploadMutate).toHaveBeenLastCalledWith(
      { root: '/ws/proj', path: 'src', files: [file], overwrite: true },
      expect.anything(),
    )
  })

  it('shows other upload errors inline', () => {
    mocks.uploadMutate.mockImplementationOnce((_vars, opts) => {
      opts?.onError?.(new ApiError('File "big.bin" exceeds 10MB limit', 400))
    })
    const { container } = renderBrowser()

    pickFiles(container, [new File(['x'], 'big.bin')])

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('File "big.bin" exceeds 10MB limit')).toBeInTheDocument()
  })
})

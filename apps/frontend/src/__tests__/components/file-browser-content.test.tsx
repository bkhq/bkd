import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { FileBrowserContent } from '@/components/files/FileBrowserContent'
import { ApiError } from '@/lib/kanban-api'
import { useFileBrowserStore } from '@/stores/file-browser-store'

const mocks = vi.hoisted(() => ({
  uploadMutate: vi.fn(),
  deleteMutate: vi.fn(),
  saveMutate: vi.fn(),
  listing: null as unknown,
  rootListing: null as unknown,
  isMobile: false,
}))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }))

const DIRECTORY = { path: 'src', type: 'directory', entries: [] }
const FILE = {
  path: 'src/a.ts',
  type: 'file',
  content: 'const a = 1\n',
  size: 12,
  isTruncated: false,
  isBinary: false,
  modifiedAt: '2026-10-13T08:00:00.000Z',
}

vi.mock('@/hooks/use-kanban', async () => ({
  queryKeys: (await vi.importActual<typeof import('@/hooks/use-kanban')>('@/hooks/use-kanban')).queryKeys,
  useProject: () => ({ data: { id: 'p1', name: 'Proj', directory: '/ws/proj' } }),
  useProjectFiles: (_root: string, path: string) => ({
    data: path === '.' && mocks.rootListing ? mocks.rootListing : mocks.listing,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteFile: () => ({ mutate: mocks.deleteMutate, isPending: false }),
  useSaveFile: () => ({ mutate: mocks.saveMutate, isPending: false }),
  useUploadFiles: () => ({ mutate: mocks.uploadMutate, isPending: false }),
}))

// The real editor is CodeMirror; a textarea stands in for it.
vi.mock('@/components/files/FileEditor', () => ({
  FileEditor: ({ value, onChange }: { value: string, onChange: (v: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

function renderBrowser(currentPath = 'src', client = new QueryClient()) {
  useFileBrowserStore.setState({
    projectId: 'p1',
    issueId: null,
    rootPath: null,
    currentPath,
    isOpen: true,
    showTree: true,
    hideIgnored: false,
  })
  return render(
    <QueryClientProvider client={client}>
      <FileBrowserContent />
    </QueryClientProvider>,
  )
}

function pickFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

describe('file browser upload', () => {
  beforeEach(async () => {
    mocks.uploadMutate.mockReset()
    mocks.saveMutate.mockReset()
    mocks.listing = DIRECTORY
    mocks.rootListing = null
    mocks.isMobile = false
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
    const zone = screen.getByText('Select a file in the tree to view or edit it')

    fireEvent.dragOver(zone, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(screen.getByText('Drop files to upload here')).toBeInTheDocument()

    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(screen.queryByText('Drop files to upload here')).not.toBeInTheDocument()
    expect(mocks.uploadMutate).toHaveBeenCalledWith(
      { root: '/ws/proj', path: 'src', files: [file], overwrite: false },
      expect.anything(),
    )
  })

  it('leaves text drags alone, so the editor can still move text', () => {
    renderBrowser()
    const zone = screen.getByText('Select a file in the tree to view or edit it')
    fireEvent.dragOver(zone, { dataTransfer: { files: [], types: ['text/plain'] } })
    expect(screen.queryByText('Drop files to upload here')).not.toBeInTheDocument()
    fireEvent.drop(zone, { dataTransfer: { files: [], types: ['text/plain'] } })
    expect(mocks.uploadMutate).not.toHaveBeenCalled()
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

describe('file browser editing', () => {
  beforeEach(async () => {
    mocks.saveMutate.mockReset()
    mocks.rootListing = null
    mocks.isMobile = false
    useFileBrowserStore.setState({ drafts: {} })
    await i18n.changeLanguage('en')
  })

  it('shows Modified + Save once the opened file is edited, and saves the draft', () => {
    mocks.listing = FILE
    renderBrowser('src/a.ts')
    expect(screen.queryByRole('button', { name: 'Save file' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'const a = 2\n' } })
    expect(screen.getByText('Modified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))

    expect(mocks.saveMutate).toHaveBeenCalledWith(
      { root: '/ws/proj', path: 'src/a.ts', content: 'const a = 2\n', expectedModifiedAt: FILE.modifiedAt },
      expect.anything(),
    )
  })

  it('on a 409 offers reload or overwrite, and overwrite saves without the version check', () => {
    mocks.listing = FILE
    mocks.saveMutate.mockImplementationOnce((_vars, opts) => {
      opts?.onError?.(new ApiError('File changed on disk since it was opened', 409))
    })
    renderBrowser('src/a.ts')
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Reload from disk' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Overwrite' }))

    expect(mocks.saveMutate).toHaveBeenLastCalledWith(
      { root: '/ws/proj', path: 'src/a.ts', content: 'mine', expectedModifiedAt: undefined },
      expect.anything(),
    )
  })

  it('ignores a draft for the same path in another workspace root', () => {
    mocks.listing = FILE
    useFileBrowserStore.getState().setDraft('/other/worktree', 'src/a.ts', { content: 'foreign', baseModifiedAt: FILE.modifiedAt })
    renderBrowser('src/a.ts')
    expect(screen.getByLabelText('editor')).toHaveValue(FILE.content)
    expect(screen.queryByText('Modified')).not.toBeInTheDocument()
  })

  it('keeps unsaved edits when the browser unmounts and comes back', () => {
    mocks.listing = FILE
    const first = renderBrowser('src/a.ts')
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'kept' } })
    first.unmount()

    renderBrowser('src/a.ts')
    expect(screen.getByLabelText('editor')).toHaveValue('kept')
    expect(screen.getByText('Modified')).toBeInTheDocument()
  })

  it('writes the saved content into the file cache before dropping the draft', () => {
    mocks.listing = FILE
    mocks.saveMutate.mockImplementationOnce((_vars, opts) => {
      opts?.onSuccess?.({ size: 5, modifiedAt: '2026-10-13T09:00:00.000Z' })
    })
    const client = new QueryClient()
    renderBrowser('src/a.ts', client)
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'saved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))

    expect(client.getQueryData(['files', '/ws/proj', 'src/a.ts', { hideIgnored: false }])).toMatchObject({
      content: 'saved',
      modifiedAt: '2026-10-13T09:00:00.000Z',
    })
    expect(useFileBrowserStore.getState().drafts).toEqual({})
  })
})

describe('file browser on a phone', () => {
  beforeEach(async () => {
    mocks.isMobile = true
    mocks.rootListing = { path: '.', type: 'directory', entries: [{ name: 'a.ts', type: 'file', size: 12, modifiedAt: FILE.modifiedAt }] }
    mocks.listing = FILE
    useFileBrowserStore.setState({ drafts: {} })
    await i18n.changeLanguage('en')
  })

  it('shows the tree full-width first, then swaps to the picked file and back', () => {
    renderBrowser('.')
    expect(screen.queryByLabelText('editor')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    expect(useFileBrowserStore.getState().currentPath).toBe('a.ts')
    expect(screen.getByLabelText('editor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'a.ts' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'File tree' }))
    expect(screen.getByRole('button', { name: 'a.ts' })).toBeInTheDocument()
  })

  it('leaves the desktop tree preference alone', () => {
    renderBrowser('.')
    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    expect(useFileBrowserStore.getState().showTree).toBe(true)
  })
})

describe('file actions menus', () => {
  const ACTIONS = ['Copy path', 'Copy relative path', 'Copy file contents', 'Download', 'Delete']

  beforeEach(async () => {
    mocks.isMobile = false
    mocks.deleteMutate.mockReset()
    mocks.rootListing = { path: '.', type: 'directory', entries: [{ name: 'a.ts', type: 'file', size: 12, modifiedAt: FILE.modifiedAt }] }
    mocks.listing = FILE
    useFileBrowserStore.setState({ drafts: {} })
    await i18n.changeLanguage('en')
  })

  it('gives the tree\'s right-click menu the same file actions as the header menu', async () => {
    renderBrowser('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }))
    const header = await screen.findAllByRole('menuitem')
    expect(header.map(i => i.textContent)).toEqual(expect.arrayContaining(ACTIONS))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'a.ts' }))
    const tree = await screen.findAllByRole('menuitem')
    expect(tree.map(i => i.textContent)).toEqual(expect.arrayContaining(ACTIONS))
  })

  it('deletes the right-clicked file after confirmation', async () => {
    renderBrowser('.')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'a.ts' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mocks.deleteMutate).toHaveBeenCalledWith({ root: '/ws/proj', path: 'a.ts' }, expect.anything())
  })

  it('clears drafts under a directory deleted from the list view too', async () => {
    mocks.listing = { path: 'src', type: 'directory', entries: [{ name: 'deep', type: 'directory', size: 0, modifiedAt: FILE.modifiedAt }] }
    mocks.deleteMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.())
    useFileBrowserStore.getState().setDraft('/ws/proj', 'src/deep/x.ts', { content: 'stale', baseModifiedAt: FILE.modifiedAt })
    renderBrowser('src')
    useFileBrowserStore.setState({ showTree: false })

    fireEvent.click(await screen.findByTitle('Delete'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteMutate).toHaveBeenCalledWith({ root: '/ws/proj', path: 'src/deep' }, expect.anything())
    expect(useFileBrowserStore.getState().drafts).toEqual({})
  })
})

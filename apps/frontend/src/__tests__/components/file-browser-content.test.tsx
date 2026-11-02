import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { FileBrowserContent } from '@/components/files/FileBrowserContent'
import { ApiError } from '@/lib/kanban-api'
import { selectDraft, useFileBrowserStore } from '@/stores/file-browser-store'

const mocks = vi.hoisted(() => ({
  uploadMutate: vi.fn(),
  deleteMutate: vi.fn(),
  saveMutate: vi.fn(),
  createMutate: vi.fn(),
  renameMutate: vi.fn(),
  searchPaths: [] as string[],
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
  // The tree loads through useQueries; initialData keeps its rows synchronous
  projectFilesQuery: (_root: string, path: string) => {
    const data = path === '.' && mocks.rootListing ? mocks.rootListing : mocks.listing
    return { queryKey: ['files', path, data], queryFn: () => data, initialData: data }
  },
  useCreateFile: () => ({ mutate: mocks.createMutate, isPending: false }),
  useRenameFile: () => ({ mutate: mocks.renameMutate, isPending: false }),
  useFileSearch: (_root: string, q: string) => ({ data: q ? { paths: mocks.searchPaths } : undefined, isFetching: false }),
  useDeleteFile: () => ({ mutate: mocks.deleteMutate, isPending: false }),
  useSaveFile: () => ({ mutate: mocks.saveMutate, isPending: false }),
  useUploadFiles: () => ({ mutate: mocks.uploadMutate, isPending: false }),
}))

// The real editor is CodeMirror; a textarea stands in for it.
vi.mock('@/components/files/FileEditor', async () => ({
  ...await vi.importActual<typeof import('@/components/files/FileEditor')>('@/components/files/FileEditor'),
  FileEditor: ({ value, onChange }: { value: string, onChange: (v: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

// jsdom has no layout: give the tree's scroll box a height so the virtualizer renders rows
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('overflow-y-auto') ? 600 : 0
    },
  })
})
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
})

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

  it('keeps edits typed while a save is in flight', () => {
    mocks.listing = FILE
    let finish: (() => void) | undefined
    mocks.saveMutate.mockImplementationOnce((_vars, opts) => {
      finish = () => opts?.onSuccess?.({ size: 2, modifiedAt: '2026-10-13T09:00:00.000Z' })
    })
    renderBrowser('src/a.ts')
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    fireEvent.change(screen.getByLabelText('editor'), { target: { value: 'v2' } })
    act(() => finish?.())

    expect(screen.getByLabelText('editor')).toHaveValue('v2')
    // Still unsaved (the mocked listing ignores the query cache, so only the
    // dirty state is asserted, not its label)
    expect(screen.getByRole('button', { name: 'Save file' })).toBeInTheDocument()
    // Based on the version just saved, so the next save is not a false conflict
    expect(selectDraft(useFileBrowserStore.getState(), '/ws/proj', 'src/a.ts')).toEqual({
      content: 'v2',
      baseModifiedAt: '2026-10-13T09:00:00.000Z',
    })
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

  it('uploads into the right-clicked directory, also when replacing a clash', async () => {
    mocks.rootListing = {
      path: '.',
      type: 'directory',
      entries: [
        { name: 'docs', type: 'directory', size: 0, modifiedAt: FILE.modifiedAt },
        { name: 'a.ts', type: 'file', size: 12, modifiedAt: FILE.modifiedAt },
      ],
    }
    mocks.uploadMutate.mockReset()
    mocks.uploadMutate.mockImplementationOnce((_vars, opts) => opts?.onError?.(new ApiError('Already exists: n.md', 409)))
    const { container } = renderBrowser('a.ts')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'docs' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Upload to this folder' }))
    const file = new File(['n'], 'n.md')
    pickFiles(container, [file])
    expect(mocks.uploadMutate).toHaveBeenLastCalledWith({ root: '/ws/proj', path: 'docs', files: [file], overwrite: false }, expect.anything())

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace' }))
    expect(mocks.uploadMutate).toHaveBeenLastCalledWith({ root: '/ws/proj', path: 'docs', files: [file], overwrite: true }, expect.anything())

    // The header button goes back to the opened file's folder (src/a.ts → src)
    fireEvent.click(screen.getByRole('button', { name: 'Upload files' }))
    pickFiles(container, [file])
    expect(mocks.uploadMutate).toHaveBeenLastCalledWith({ root: '/ws/proj', path: 'src', files: [file], overwrite: false }, expect.anything())
  })

  it('uploads beside a right-clicked file', async () => {
    mocks.uploadMutate.mockReset()
    mocks.listing = DIRECTORY
    mocks.rootListing = { path: '.', type: 'directory', entries: [{ name: 'a.ts', type: 'file', size: 12, modifiedAt: FILE.modifiedAt }] }
    const { container } = renderBrowser('src')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'a.ts' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Upload to this folder' }))
    const file = new File(['x'], 'x.txt')
    pickFiles(container, [file])
    expect(mocks.uploadMutate).toHaveBeenLastCalledWith({ root: '/ws/proj', path: '.', files: [file], overwrite: false }, expect.anything())
  })
})

describe('create, rename and quick open', () => {
  const ROOT = {
    path: '.',
    type: 'directory',
    entries: [
      { name: 'docs', type: 'directory', size: 0, modifiedAt: FILE.modifiedAt },
      { name: 'a.ts', type: 'file', size: 12, modifiedAt: FILE.modifiedAt },
    ],
  }

  beforeEach(async () => {
    mocks.isMobile = false
    mocks.createMutate.mockReset()
    mocks.renameMutate.mockReset()
    mocks.rootListing = ROOT
    mocks.listing = FILE
    mocks.searchPaths = []
    useFileBrowserStore.setState({ drafts: {} })
    await i18n.changeLanguage('en')
  })

  it('creates a file in the right-clicked folder and opens it', async () => {
    mocks.createMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.())
    renderBrowser('.')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'docs' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New file' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'notes.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(mocks.createMutate).toHaveBeenCalledWith({ root: '/ws/proj', path: 'docs/notes.md', type: 'file' }, expect.anything())
    expect(useFileBrowserStore.getState().currentPath).toBe('docs/notes.md')
  })

  it('keeps the dialog open with an error when the name is taken', async () => {
    mocks.createMutate.mockImplementation((_vars, opts) => opts?.onError?.(new ApiError('Path already exists', 409)))
    renderBrowser('.')
    fireEvent.click(screen.getAllByRole('button', { name: 'New folder' })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'docs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(mocks.createMutate).toHaveBeenCalledWith({ root: '/ws/proj', path: 'docs', type: 'directory' }, expect.anything())
    expect(screen.getByRole('alert')).toHaveTextContent('A file or folder with that name already exists')
  })

  it('refuses a name with a slash before calling the server', async () => {
    renderBrowser('.')
    fireEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'a/b.ts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(mocks.createMutate).not.toHaveBeenCalled()
  })

  it('renames the open file, following it with its unsaved edits', async () => {
    mocks.renameMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.())
    renderBrowser('a.ts')
    useFileBrowserStore.getState().setDraft('/ws/proj', 'a.ts', { content: 'edited', baseModifiedAt: FILE.modifiedAt })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'a.ts' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveValue('a.ts')
    fireEvent.change(input, { target: { value: 'b.ts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    expect(mocks.renameMutate).toHaveBeenCalledWith({ root: '/ws/proj', path: 'a.ts', to: 'b.ts' }, expect.anything())
    const state = useFileBrowserStore.getState()
    expect(state.currentPath).toBe('b.ts')
    expect(selectDraft(state, '/ws/proj', 'b.ts')?.content).toBe('edited')
    expect(selectDraft(state, '/ws/proj', 'a.ts')).toBeNull()
  })

  it('opens a file picked from quick open (Ctrl+P)', async () => {
    // cmdk observes its list size; jsdom has no ResizeObserver
    vi.stubGlobal('ResizeObserver', class {
      observe() {} unobserve() {} disconnect() {}
    })
    mocks.searchPaths = ['docs/guide.md']
    const { container } = renderBrowser('.')
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'p', ctrlKey: true })
    fireEvent.change(await screen.findByPlaceholderText('Search files by name…'), { target: { value: 'guide' } })
    fireEvent.click(await screen.findByRole('option', { name: /guide\.md/ }))
    expect(useFileBrowserStore.getState().currentPath).toBe('docs/guide.md')
    vi.unstubAllGlobals()
  })

  it('renders only the visible rows of a huge directory', () => {
    mocks.rootListing = {
      path: '.',
      type: 'directory',
      entries: Array.from({ length: 3000 }, (_, i) => ({ name: `f${String(i).padStart(4, '0')}.ts`, type: 'file', size: 1, modifiedAt: FILE.modifiedAt })),
    }
    renderBrowser('.')
    expect(screen.getByRole('button', { name: 'f0000.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'f2999.ts' })).toBeNull()
  })
})

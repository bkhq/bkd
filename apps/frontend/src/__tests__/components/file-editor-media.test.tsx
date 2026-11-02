import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileEditor } from '@/components/files/FileEditor'
import { kanbanApi } from '@/lib/kanban-api'
import type { FileContent } from '@/types/kanban'

/** Images and PDFs open from the raw-file API instead of the editor. */

vi.mock('@/components/files/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea aria-label="editor" value={value} readOnly />,
}))

function file(path: string, isBinary: boolean, content = ''): FileContent {
  return { path, type: 'file', content, size: 10, isTruncated: false, isBinary, modifiedAt: '' }
}

function renderEditor(f: FileContent, { root = '/ws/proj' as string | null, preview = false } = {}) {
  return render(
    <FileEditor file={f} root={root} value={f.content} onChange={() => {}} onSave={() => {}} wrap={false} preview={preview} />,
  )
}

describe('fileEditor media preview', () => {
  it('shows a raster image from the raw-file API', () => {
    renderEditor(file('img/logo.PNG', true))
    expect(screen.getByRole('img', { name: 'logo.PNG' })).toHaveAttribute('src', kanbanApi.rawFileUrl('/ws/proj', 'img/logo.PNG'))
  })

  it('frames a PDF inline even when it was not detected as binary', () => {
    const { container } = renderEditor(file('docs/spec.pdf', false, '%PDF-1.4'))
    expect(container.querySelector('iframe')).toHaveAttribute('src', `${kanbanApi.rawFileUrl('/ws/proj', 'docs/spec.pdf')}?inline=1`)
    expect(screen.queryByLabelText('editor')).toBeNull()
  })

  it('edits an SVG as text and shows it as an image in preview', async () => {
    const svg = file('icon.svg', false, '<svg/>')
    const { rerender } = renderEditor(svg)
    expect(await screen.findByLabelText('editor')).toBeInTheDocument()
    rerender(<FileEditor file={svg} root="/ws/proj" value="<svg/>" onChange={() => {}} onSave={() => {}} wrap={false} preview />)
    expect(screen.getByRole('img', { name: 'icon.svg' })).toHaveAttribute('src', kanbanApi.rawFileUrl('/ws/proj', 'icon.svg'))
  })

  it('keeps the binary placeholder without a workspace root', () => {
    renderEditor(file('logo.png', true), { root: null })
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/binary|二进制/i)).toBeInTheDocument()
  })
})

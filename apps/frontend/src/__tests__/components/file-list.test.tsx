import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileList } from '@/components/files/FileList'

describe('fileList', () => {
  const entry = { name: 'a.ts', type: 'file' as const, size: 12, modifiedAt: new Date(Date.now() - 3 * 86400_000).toISOString() }

  it('shows the modification date as a concrete time', () => {
    render(<FileList entries={[entry]} onNavigate={() => {}} />)
    const expected = new Date(entry.modifiedAt).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(/ago/)).toBeNull()
  })

  it('hands deletes to the caller without its own dialog', () => {
    const onDelete = vi.fn()
    render(<FileList entries={[entry]} onNavigate={() => {}} onDelete={onDelete} />)
    fireEvent.click(screen.getByTitle('fileBrowser.delete'))
    expect(onDelete).toHaveBeenCalledWith('a.ts', 'file')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

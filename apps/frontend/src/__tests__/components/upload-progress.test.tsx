import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { UploadProgress } from '@/components/UploadProgress'
import { useUploadStore } from '@/stores/upload-store'
import '@/i18n'

describe('uploadProgress', () => {
  beforeEach(() => {
    useUploadStore.setState({ uploads: [] })
  })

  it('renders nothing without uploads', () => {
    const { container } = render(<UploadProgress />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the file name, percentage and bytes of an in-flight upload', () => {
    render(<UploadProgress />)
    act(() => {
      const id = useUploadStore.getState().start([new File(['x'], 'video.mp4'), new File(['y'], 'b.txt')])
      useUploadStore.getState().progress(id, 512 * 1024, 2 * 1024 * 1024)
    })
    expect(screen.getByText('video.mp4')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('512.0KB / 2.0MB')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })
})

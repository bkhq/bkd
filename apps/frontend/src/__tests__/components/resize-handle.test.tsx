import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResizeHandle } from '@/components/ui/resize-handle'

/** Shared panel resize handle (UI-004). */

function setup(props: Partial<Parameters<typeof ResizeHandle>[0]> = {}) {
  const onWidthChange = vi.fn()
  render(
    <ResizeHandle
      width={400}
      onWidthChange={onWidthChange}
      min={200}
      max={900}
      label="Resize panel"
      {...props}
    />,
  )
  return { handle: screen.getByRole('separator'), onWidthChange }
}

/** jsdom has no pointer capture API. */
function pointerDown(handle: HTMLElement, clientX: number) {
  Object.assign(handle, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  fireEvent.pointerDown(handle, { button: 0, clientX, pointerId: 1 })
}

describe('resizeHandle', () => {
  it('exposes separator state to assistive technology', () => {
    const { handle } = setup()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-label', 'Resize panel')
    expect(handle).toHaveAttribute('aria-valuenow', '400')
    expect(handle).toHaveAttribute('aria-valuemin', '200')
    expect(handle).toHaveAttribute('aria-valuemax', '900')
    expect(handle).toHaveAttribute('tabindex', '0')
  })

  it('grows a left-edge panel when dragged left', () => {
    const { handle, onWidthChange } = setup()
    pointerDown(handle, 500)
    fireEvent.pointerMove(handle, { clientX: 460 })
    expect(onWidthChange).toHaveBeenCalledWith(440)
  })

  it('grows a right-edge panel when dragged right', () => {
    const { handle, onWidthChange } = setup({ edge: 'right' })
    pointerDown(handle, 500)
    fireEvent.pointerMove(handle, { clientX: 540 })
    expect(onWidthChange).toHaveBeenCalledWith(440)
  })

  it('ignores movement once the pointer is released', () => {
    const { handle, onWidthChange } = setup()
    pointerDown(handle, 500)
    fireEvent.pointerUp(handle)
    fireEvent.pointerMove(handle, { clientX: 300 })
    expect(onWidthChange).not.toHaveBeenCalled()
  })

  it('releases the drag when the pointer is cancelled', () => {
    const { handle, onWidthChange } = setup()
    pointerDown(handle, 500)
    fireEvent.pointerCancel(handle)
    fireEvent.pointerMove(handle, { clientX: 300 })
    expect(onWidthChange).not.toHaveBeenCalled()
  })

  it('resizes with the keyboard, in the direction the edge implies', () => {
    const left = setup()
    fireEvent.keyDown(left.handle, { key: 'ArrowLeft' })
    expect(left.onWidthChange).toHaveBeenCalledWith(410)
    fireEvent.keyDown(left.handle, { key: 'ArrowRight', shiftKey: true })
    expect(left.onWidthChange).toHaveBeenCalledWith(350)
  })

  it('inverts keyboard direction for a right-edge handle', () => {
    const { handle, onWidthChange } = setup({ edge: 'right' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenCalledWith(410)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onWidthChange).toHaveBeenCalledWith(390)
  })

  it('ignores non-primary buttons', () => {
    const { handle, onWidthChange } = setup()
    Object.assign(handle, { setPointerCapture: vi.fn() })
    fireEvent.pointerDown(handle, { button: 2, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 300 })
    expect(onWidthChange).not.toHaveBeenCalled()
  })
})

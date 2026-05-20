import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useClickOutside } from '@/hooks/use-click-outside'

describe('useClickOutside — mobile touch support (regression)', () => {
  it('closes on mousedown outside the ref', () => {
    const onClose = vi.fn()
    const div = document.createElement('div')
    document.body.appendChild(div)
    const ref = { current: div }

    renderHook(() => useClickOutside(ref, true, onClose))
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    document.body.removeChild(div)
  })

  it('closes on touchstart outside the ref (mobile)', () => {
    const onClose = vi.fn()
    const div = document.createElement('div')
    document.body.appendChild(div)
    const ref = { current: div }

    renderHook(() => useClickOutside(ref, true, onClose))
    document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    document.body.removeChild(div)
  })

  it('does NOT close when touchstart happens inside the ref', () => {
    const onClose = vi.fn()
    const div = document.createElement('div')
    document.body.appendChild(div)
    const ref = { current: div }

    renderHook(() => useClickOutside(ref, true, onClose))
    div.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    document.body.removeChild(div)
  })

  it('does not attach listeners when open is false', () => {
    const onClose = vi.fn()
    const div = document.createElement('div')
    const ref = { current: div }

    renderHook(() => useClickOutside(ref, false, onClose))
    document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
  })
})

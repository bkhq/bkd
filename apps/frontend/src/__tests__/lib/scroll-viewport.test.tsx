import type { RefObject } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScrollArea } from '@/components/ui/scroll-area'
import { viewportRef } from '@/lib/scroll-viewport'

describe('viewportRef', () => {
  it('stores the ScrollArea viewport, the element that scrolls', () => {
    const ref: RefObject<HTMLDivElement | null> = { current: null }
    render(<ScrollArea ref={viewportRef(ref)}><p>body</p></ScrollArea>)
    expect(ref.current).toHaveAttribute('data-slot', 'scroll-area-viewport')
    expect(ref.current).toHaveTextContent('body')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TreePane } from '@/components/files/TreePane'
import { useTreePaneStore } from '@/stores/tree-pane-store'

describe('treePane', () => {
  it('never takes more than 60% of the panel, so the content beside it keeps room', () => {
    useTreePaneStore.setState({ width: 480 })
    render(<TreePane><span>tree</span></TreePane>)
    const pane = screen.getByText('tree').closest('aside')!
    expect(pane).toHaveStyle({ width: '480px', maxWidth: '60%' })
  })
})

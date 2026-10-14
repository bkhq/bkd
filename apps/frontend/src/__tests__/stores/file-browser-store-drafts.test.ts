import { beforeEach, describe, expect, it } from 'vitest'
import { selectDraft, useFileBrowserStore } from '@/stores/file-browser-store'

const draft = { content: 'edited', baseModifiedAt: '2026-10-13T08:00:00.000Z' }

describe('file-browser-store drafts', () => {
  beforeEach(() => useFileBrowserStore.setState({ drafts: {} }))

  it('keys drafts by workspace root and path, so worktrees never share one', () => {
    useFileBrowserStore.getState().setDraft('/wt/a', 'README.md', draft)
    const s = useFileBrowserStore.getState()
    expect(selectDraft(s, '/wt/a', 'README.md')).toEqual(draft)
    expect(selectDraft(s, '/wt/b', 'README.md')).toBeNull()
  })

  it('clears a draft with null', () => {
    useFileBrowserStore.getState().setDraft('/wt/a', 'README.md', draft)
    useFileBrowserStore.getState().setDraft('/wt/a', 'README.md', null)
    expect(selectDraft(useFileBrowserStore.getState(), '/wt/a', 'README.md')).toBeNull()
  })

  it('clearDraftsUnder drops a path and everything inside it, in that root only', () => {
    const { setDraft, clearDraftsUnder } = useFileBrowserStore.getState()
    setDraft('/wt/a', 'src/x.ts', draft)
    setDraft('/wt/a', 'src/deep/y.ts', draft)
    setDraft('/wt/a', 'srcs/z.ts', draft)
    setDraft('/wt/b', 'src/x.ts', draft)
    clearDraftsUnder('/wt/a', 'src')
    const s = useFileBrowserStore.getState()
    expect(selectDraft(s, '/wt/a', 'src/x.ts')).toBeNull()
    expect(selectDraft(s, '/wt/a', 'src/deep/y.ts')).toBeNull()
    expect(selectDraft(s, '/wt/a', 'srcs/z.ts')).toEqual(draft)
    expect(selectDraft(s, '/wt/b', 'src/x.ts')).toEqual(draft)
  })

  it('asks before unloading the page while a draft exists', () => {
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    useFileBrowserStore.getState().setDraft('/wt/a', 'README.md', draft)
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShikiPatchDiff } from '@/components/issue-detail/CodeRenderers'

/**
 * A diff parsed from a patch alone is partial. @pierre/diffs throws
 * "loadDiffFiles is required" when asked to expand unchanged lines on one.
 */

const seen: { fileDiff: { isPartial: boolean }, options: { expandUnchanged?: boolean, loadDiffFiles?: unknown } }[] = []

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: (props: (typeof seen)[number]) => {
    seen.push(props)
    return <div data-testid="file-diff" />
  },
  MultiFileDiff: () => null,
}))

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4',
  '',
].join('\n')

describe('shikiPatchDiff', () => {
  it('does not ask a partial diff to expand unchanged lines', async () => {
    const { findByTestId } = render(<ShikiPatchDiff patch={PATCH} filePath="src/a.ts" />)
    await findByTestId('file-diff')

    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const { fileDiff, options } = seen.at(-1)!
    expect(fileDiff.isPartial).toBe(true)
    expect(options.expandUnchanged === true && options.loadDiffFiles == null).toBe(false)
  })
})

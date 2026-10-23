import { render, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
  // The component parses the patch with the real @pierre/diffs, imported lazily on
  // first render. Cold-loading that library takes 300-500 ms (more on a busy
  // machine) and would otherwise fall inside findByTestId's 1 s window, on top of
  // React's 300 ms Suspense reveal throttle. Load it here so the test measures the
  // render, not module loading.
  beforeAll(async () => {
    await import('@pierre/diffs')
  })

  it('does not ask a partial diff to expand unchanged lines', async () => {
    const { findByTestId } = render(<ShikiPatchDiff patch={PATCH} filePath="src/a.ts" />)
    await findByTestId('file-diff')

    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const { fileDiff, options } = seen.at(-1)!
    expect(fileDiff.isPartial).toBe(true)
    expect(options.expandUnchanged === true && options.loadDiffFiles == null).toBe(false)
  })
})

/**
 * Regression: useRecentIssues used to read localStorage exactly once on
 * mount. Any component holding a reference saw stale data until remounted.
 * Now it's a useSyncExternalStore subscription — every consumer rerenders
 * when addRecentIssue / removeRecentIssue / clearRecentIssues fires.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addRecentIssue,
  clearRecentIssues,
  removeRecentIssue,
  useRecentIssues,
} from '@/hooks/use-recent-issues'

const make = (id: string, n: number, alias = 'alpha') => ({
  id,
  title: `Issue ${n}`,
  issueNumber: n,
  projectAlias: alias,
  projectName: alias,
  statusId: 'working',
})

describe('useRecentIssues', () => {
  beforeEach(() => clearRecentIssues())
  afterEach(() => clearRecentIssues())

  it('starts empty', () => {
    const { result } = renderHook(() => useRecentIssues())
    expect(result.current).toEqual([])
  })

  it('addRecentIssue triggers a re-render in existing consumer', () => {
    const { result } = renderHook(() => useRecentIssues())
    expect(result.current.length).toBe(0)
    act(() => addRecentIssue(make('a', 1)))
    expect(result.current.length).toBe(1)
    expect(result.current[0].issueNumber).toBe(1)
  })

  it('adding a duplicate id moves it to the head without growing the list', () => {
    const { result } = renderHook(() => useRecentIssues())
    act(() => addRecentIssue(make('a', 1)))
    act(() => addRecentIssue(make('b', 2)))
    act(() => addRecentIssue(make('a', 1)))
    expect(result.current.length).toBe(2)
    expect(result.current[0].id).toBe('a')
    expect(result.current[1].id).toBe('b')
  })

  it('removeRecentIssue notifies all consumers', () => {
    const { result } = renderHook(() => useRecentIssues())
    act(() => addRecentIssue(make('a', 1)))
    act(() => addRecentIssue(make('b', 2)))
    expect(result.current.length).toBe(2)
    act(() => removeRecentIssue('a'))
    expect(result.current.length).toBe(1)
    expect(result.current[0].id).toBe('b')
  })

  it('caps at 20 entries (MAX_ITEMS)', () => {
    const { result } = renderHook(() => useRecentIssues())
    act(() => {
      for (let i = 0; i < 25; i++) addRecentIssue(make(`id-${i}`, i))
    })
    expect(result.current.length).toBe(20)
    // most-recent first → id-24 head, id-5 tail
    expect(result.current[0].id).toBe('id-24')
    expect(result.current[19].id).toBe('id-5')
  })

  it('two independent hook instances see the same updates', () => {
    const a = renderHook(() => useRecentIssues())
    const b = renderHook(() => useRecentIssues())
    act(() => addRecentIssue(make('x', 9)))
    expect(a.result.current.length).toBe(1)
    expect(b.result.current.length).toBe(1)
    expect(a.result.current[0].id).toBe('x')
    expect(b.result.current[0].id).toBe('x')
  })
})

import { describe, expect, it } from 'vitest'
import { sortKnownPaths, splitByKnownPaths } from '@/lib/path-chips'

describe('sortKnownPaths', () => {
  it('normalizes ./ prefix and backslashes', () => {
    const result = sortKnownPaths(['./apps/api/foo.ts', 'src\\bar.ts'])
    expect(result).toContain('apps/api/foo.ts')
    expect(result).toContain('src/bar.ts')
  })

  it('returns longest path first', () => {
    const result = sortKnownPaths(['foo.ts', 'src/foo.ts', 'apps/api/src/foo.ts'])
    expect(result[0]).toBe('apps/api/src/foo.ts')
    expect(result[1]).toBe('src/foo.ts')
    expect(result[2]).toBe('foo.ts')
  })

  it('deduplicates after normalization', () => {
    const result = sortKnownPaths(['./foo.ts', 'foo.ts'])
    expect(result).toHaveLength(1)
  })

  it('drops empty strings', () => {
    const result = sortKnownPaths(['', './'])
    expect(result).toHaveLength(0)
  })
})

describe('splitByKnownPaths', () => {
  it('returns a single text segment when nothing matches', () => {
    const segments = splitByKnownPaths('nothing interesting here', ['foo.ts'])
    expect(segments).toEqual([{ type: 'text', text: 'nothing interesting here' }])
  })

  it('returns the text untouched when known paths is empty', () => {
    const segments = splitByKnownPaths('apps/api/foo.ts', [])
    expect(segments).toEqual([{ type: 'text', text: 'apps/api/foo.ts' }])
  })

  it('replaces a single match with a path segment', () => {
    const segments = splitByKnownPaths('I changed src/foo.ts today', ['src/foo.ts'])
    expect(segments).toEqual([
      { type: 'text', text: 'I changed ' },
      { type: 'path', path: 'src/foo.ts', matched: 'src/foo.ts' },
      { type: 'text', text: ' today' },
    ])
  })

  it('captures a :LINE suffix', () => {
    const segments = splitByKnownPaths('see src/foo.ts:42 for context', ['src/foo.ts'])
    expect(segments).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'path', path: 'src/foo.ts', matched: 'src/foo.ts:42', line: 42 },
      { type: 'text', text: ' for context' },
    ])
  })

  it('captures a :LINE-LINE range suffix', () => {
    const segments = splitByKnownPaths('see src/foo.ts:10-20 here', ['src/foo.ts'])
    expect(segments[1]).toEqual({
      type: 'path',
      path: 'src/foo.ts',
      matched: 'src/foo.ts:10-20',
      line: 10,
    })
  })

  it('prefers the longer path when both match the same span', () => {
    const segments = splitByKnownPaths(
      'apps/api/src/foo.ts is interesting',
      sortKnownPaths(['foo.ts', 'src/foo.ts', 'apps/api/src/foo.ts']),
    )
    expect(segments[0]).toEqual({
      type: 'path',
      path: 'apps/api/src/foo.ts',
      matched: 'apps/api/src/foo.ts',
    })
  })

  it('rejects matches that continue with a path character', () => {
    // `foo.ts` should NOT match when followed by `x` — that would be a
    // different filename.
    const segments = splitByKnownPaths('see foo.tsx not foo.ts', ['foo.ts'])
    // Must skip the `foo.tsx` occurrence but match the second `foo.ts`.
    const pathSegments = segments.filter(s => s.type === 'path')
    expect(pathSegments).toHaveLength(1)
    expect(pathSegments[0]).toMatchObject({ matched: 'foo.ts' })
  })

  it('rejects matches that are preceded by a path character', () => {
    // `bar.ts` inside `foobar.ts` must not match `bar.ts`.
    const segments = splitByKnownPaths('foobar.ts is here', ['bar.ts'])
    expect(segments.filter(s => s.type === 'path')).toHaveLength(0)
  })

  it('handles multiple matches in one string', () => {
    const segments = splitByKnownPaths(
      'I edited src/a.ts and then src/b.ts:9.',
      sortKnownPaths(['src/a.ts', 'src/b.ts']),
    )
    const matches = segments.filter(s => s.type === 'path')
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ path: 'src/a.ts' })
    expect(matches[1]).toMatchObject({ path: 'src/b.ts', line: 9 })
  })
})

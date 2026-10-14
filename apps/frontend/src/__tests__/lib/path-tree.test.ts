import { describe, expect, it } from 'vitest'
import { buildPathTree, joinRootPath } from '@/lib/path-tree'

describe('buildPathTree', () => {
  it('lists directories before files, each sorted by name', () => {
    const tree = buildPathTree(['b.ts', 'src/x.ts', 'a.ts', 'lib/y.ts'])
    expect(tree.map(n => n.name)).toEqual(['lib', 'src', 'a.ts', 'b.ts'])
  })

  it('compresses chains of single-child directories', () => {
    const tree = buildPathTree(['src/components/pages/assets/Dialog.tsx'])
    expect(tree).toEqual([
      {
        name: 'src/components/pages/assets',
        path: 'src/components/pages/assets',
        children: [{ name: 'Dialog.tsx', path: 'src/components/pages/assets/Dialog.tsx' }],
      },
    ])
  })

  it('stops compressing where a directory also holds files or several children', () => {
    const tree = buildPathTree(['a/x.ts', 'a/b/y.ts', 'a/b/z.ts'])
    expect(tree).toEqual([
      {
        name: 'a',
        path: 'a',
        children: [
          {
            name: 'b',
            path: 'a/b',
            children: [
              { name: 'y.ts', path: 'a/b/y.ts' },
              { name: 'z.ts', path: 'a/b/z.ts' },
            ],
          },
          { name: 'x.ts', path: 'a/x.ts' },
        ],
      },
    ])
  })
})

describe('joinRootPath', () => {
  it('joins a root and a relative path, tolerating a trailing slash', () => {
    expect(joinRootPath('/srv/work/blog/', 'src/a.ts')).toBe('/srv/work/blog/src/a.ts')
    expect(joinRootPath('/srv/work/blog', '.')).toBe('/srv/work/blog')
  })

  it('falls back to the relative path without a root', () => {
    expect(joinRootPath(undefined, 'src/a.ts')).toBe('src/a.ts')
  })
})

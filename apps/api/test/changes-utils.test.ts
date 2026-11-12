import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectChanges, countTextLines, isPathInsideRoot } from '@/utils/changes'

describe('isPathInsideRoot', () => {
  test('allows simple relative paths', () => {
    expect(isPathInsideRoot('/repo', 'src/file.ts')).toBe(true)
  })

  test('allows nested paths', () => {
    expect(isPathInsideRoot('/repo', 'a/b/c/d.txt')).toBe(true)
  })

  test('rejects parent traversal', () => {
    expect(isPathInsideRoot('/repo', '../etc/passwd')).toBe(false)
  })

  test('rejects traversal via intermediate ..', () => {
    expect(isPathInsideRoot('/repo', 'src/../../etc/passwd')).toBe(false)
  })

  test('rejects absolute path outside root', () => {
    expect(isPathInsideRoot('/repo', '/etc/passwd')).toBe(false)
  })

  test('allows root itself', () => {
    expect(isPathInsideRoot('/repo', '.')).toBe(true)
  })

  test('handles root with trailing slash', () => {
    expect(isPathInsideRoot('/repo/', 'file.ts')).toBe(true)
    expect(isPathInsideRoot('/repo/', '../x')).toBe(false)
  })
})

describe('countTextLines', () => {
  test('counts simple lines', () => {
    expect(countTextLines('a\nb\nc')).toBe(3)
  })

  test('handles trailing newline', () => {
    expect(countTextLines('a\nb\nc\n')).toBe(3)
  })

  test('handles CRLF', () => {
    expect(countTextLines('a\r\nb\r\nc')).toBe(3)
  })

  test('returns 0 for empty string', () => {
    expect(countTextLines('')).toBe(0)
  })

  test('single line no newline', () => {
    expect(countTextLines('hello')).toBe(1)
  })

  test('single line with newline', () => {
    expect(countTextLines('hello\n')).toBe(1)
  })
})

describe('collectChanges', () => {
  async function git(cwd: string, ...args: string[]) {
    const proc = Bun.spawn(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })
    expect(await proc.exited).toBe(0)
  }

  async function repo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bkd-changes-'))
    await git(dir, 'init', '-q')
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
    await writeFile(join(dir, 'old name.txt'), 'x\ny\nz\n')
    await git(dir, 'add', '.')
    await git(dir, 'commit', '-qm', 'init')
    return dir
  }

  test('reports nothing for a clean tree', async () => {
    const dir = await repo()
    expect(await collectChanges(dir)).toEqual({ files: [], additions: 0, deletions: 0 })
    await rm(dir, { recursive: true })
  })

  test('counts modified, renamed and untracked files once each', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'a.txt'), 'one\nTWO\nthree\n')
    await git(dir, 'add', 'a.txt')
    await writeFile(join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\n')
    await git(dir, 'mv', 'old name.txt', 'new name.txt')
    await writeFile(join(dir, 'fresh.txt'), 'l1\nl2\n')

    const { files, additions, deletions } = await collectChanges(dir)
    const byPath = Object.fromEntries(files.map(f => [f.path, f]))
    expect(Object.keys(byPath).sort()).toEqual(['a.txt', 'fresh.txt', 'new name.txt'])
    expect(byPath['a.txt']).toMatchObject({ type: 'modified', additions: 3, deletions: 1 })
    expect(byPath['fresh.txt']).toMatchObject({ type: 'untracked', additions: 2, deletions: 0 })
    expect(byPath['new name.txt']).toMatchObject({ type: 'renamed', previousPath: 'old name.txt', additions: 0, deletions: 0 })
    expect({ additions, deletions }).toEqual({ additions: 5, deletions: 1 })
    await rm(dir, { recursive: true })
  })
})

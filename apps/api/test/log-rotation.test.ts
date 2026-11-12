import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rotatingFileStream } from '@/log-rotation'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bkd-log-rotation-'))
  file = join(dir, 'bkd.log')
})

afterEach(() => {
  rmSync(dir, { recursive: true })
})

describe('rotatingFileStream', () => {
  test('appends below the limit without rotating', () => {
    const stream = rotatingFileStream(file, { maxBytes: 100, keep: 2 })
    stream.write('one\n')
    stream.write('two\n')
    expect(readFileSync(file, 'utf8')).toBe('one\ntwo\n')
    expect(readdirSync(dir)).toEqual(['bkd.log'])
  })

  test('rotates once the file would exceed the limit', () => {
    const stream = rotatingFileStream(file, { maxBytes: 10, keep: 2 })
    stream.write('aaaaaaaa\n')
    stream.write('bbbbbbbb\n')
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('aaaaaaaa\n')
    expect(readFileSync(file, 'utf8')).toBe('bbbbbbbb\n')
  })

  test('keeps only the configured number of rotated files', () => {
    const stream = rotatingFileStream(file, { maxBytes: 10, keep: 2 })
    for (const line of ['1111111\n', '2222222\n', '3333333\n', '4444444\n']) stream.write(line)
    expect(readFileSync(file, 'utf8')).toBe('4444444\n')
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('3333333\n')
    expect(readFileSync(`${file}.2`, 'utf8')).toBe('2222222\n')
    expect(existsSync(`${file}.3`)).toBe(false)
  })

  test('counts what is already in the file when it opens', () => {
    writeFileSync(file, 'x'.repeat(9))
    const stream = rotatingFileStream(file, { maxBytes: 10, keep: 1 })
    stream.write('next\n')
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(9))
    expect(readFileSync(file, 'utf8')).toBe('next\n')
  })

  test('counts bytes, not characters', () => {
    const stream = rotatingFileStream(file, { maxBytes: 10, keep: 1 })
    stream.write('日志日\n')
    stream.write('ab\n')
    expect(readFileSync(file, 'utf8')).toBe('ab\n')
  })
})

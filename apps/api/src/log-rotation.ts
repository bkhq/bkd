import { closeSync, openSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'

/**
 * Append-only file stream that keeps a log size-capped: when a write would
 * take the file past `maxBytes` it becomes `<file>.1` (older ones shift up,
 * the one past `keep` is deleted) and a new file starts. Writes are synchronous.
 */
export function rotatingFileStream(
  file: string,
  { maxBytes, keep }: { maxBytes: number, keep: number },
): { write: (chunk: string) => void } {
  let fd = openSync(file, 'a')
  let size = statSync(file).size

  const rotate = () => {
    closeSync(fd)
    rmSync(`${file}.${keep}`, { force: true })
    for (let n = keep - 1; n >= 1; n--) {
      try {
        renameSync(`${file}.${n}`, `${file}.${n + 1}`)
      } catch {
        // that generation does not exist yet
      }
    }
    renameSync(file, `${file}.1`)
    fd = openSync(file, 'a')
    size = 0
  }

  return {
    write(chunk) {
      const bytes = Buffer.byteLength(chunk)
      if (size > 0 && size + bytes > maxBytes) rotate()
      writeSync(fd, chunk)
      size += bytes
    },
  }
}

import { existsSync, rmSync } from 'node:fs'
import { resolveDbPath } from './migrations-source'

const dbPath = resolveDbPath()

const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]

const deleted: string[] = []
const missing: string[] = []

for (const file of candidates) {
  if (existsSync(file)) {
    rmSync(file, { force: true })
    deleted.push(file)
  } else {
    missing.push(file)
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dbPath,
      deleted,
      missing,
      timestamp: new Date().toISOString(),
    },
    null,
    2,
  ),
)

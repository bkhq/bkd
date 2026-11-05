import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDriverContract } from '@/fm/server/contract'
import { workspaceDriver } from '@/routes/fm'

/** The project driver must still meet the fm driver contract with its hidden folders moved out. */
runDriverContract('workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bkd-fm-contract-'))
  process.env.BKD_FM_DATA_DIR = join(dir, 'data')
  const root = join(dir, 'root')
  mkdirSync(root)
  return { driver: workspaceDriver(root), cleanup: async () => rmSync(dir, { recursive: true, force: true }) }
})

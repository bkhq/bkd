import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const REPO = resolve(import.meta.dir, '../../..')
const SCRIPT = resolve(REPO, 'scripts/migrate-to-lode.ts')
const TEMPLATE = resolve(REPO, 'docs/bkd.lode.toml')

let root: string

/** Build a launcher-style install: an active version plus user data. */
function seedOldInstall(version = '0.0.6') {
  mkdirSync(resolve(root, `data/app/v${version}`), { recursive: true })
  mkdirSync(resolve(root, 'data/updates'), { recursive: true })
  mkdirSync(resolve(root, 'data/db'), { recursive: true })
  mkdirSync(resolve(root, 'data/uploads'), { recursive: true })
  writeFileSync(
    resolve(root, 'data/app/version.json'),
    JSON.stringify({ version, updatedAt: new Date().toISOString() }),
  )
  writeFileSync(resolve(root, `data/app/v${version}/server.js`), 'console.log("app")')
  writeFileSync(resolve(root, 'data/updates/bkd-app-v0.0.5.tar.gz'), 'stale')
  writeFileSync(resolve(root, 'data/db/bkd.db'), 'sqlite-bytes')
  writeFileSync(resolve(root, 'data/uploads/note.txt'), 'user file')
}

function run(...extra: string[]) {
  const env = { ...process.env }
  for (const key of ['BKD_DATA_DIR', 'DB_PATH', 'WORKTREE_DIR']) delete env[key]

  const proc = Bun.spawnSync(['bun', SCRIPT, '--root', root, ...extra], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'bkd-migrate-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('migrate-to-lode', () => {
  it('dry-runs by default without writing anything', () => {
    seedOldInstall()
    const { exitCode, stdout } = run()

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Dry run')
    expect(stdout).toContain('Active version: 0.0.6')
    expect(existsSync(resolve(root, 'lode.toml'))).toBe(false)
    expect(existsSync(resolve(root, 'migration'))).toBe(false)
    expect(existsSync(resolve(root, 'data/app'))).toBe(true)
  })

  it('writes a lode.toml pointing at the existing install root', () => {
    seedOldInstall()
    const { exitCode } = run('--apply')

    expect(exitCode).toBe(0)
    const toml = readFileSync(resolve(root, 'lode.toml'), 'utf8')
    expect(toml).toContain(`dir = "${root}"`)
    expect(toml).toContain(`ROOT_DIR  = "${root}"`)
    expect(toml).toContain('asset   = "bkd-server.tar.gz"')
    expect(toml).toContain('github  = "bkhq/bkd"')
    // Ships conservative defaults: advertise updates, do not auto-install them,
    // and do not require signatures (releases are not signed yet).
    expect(toml).toContain('policy  = "check"')
    expect(toml).toContain('require_signature = "off"')
  })

  it('packs the active version so it can be seeded as a rollback target', () => {
    seedOldInstall()
    const { exitCode, stdout } = run('--apply')

    expect(exitCode).toBe(0)
    expect(existsSync(resolve(root, 'migration/bkd-server.tar.gz'))).toBe(true)
    expect(stdout).toContain('lode-cli seed')
    expect(stdout).toContain('--version 0.0.6')
  })

  it('never removes user data, with or without --prune', () => {
    seedOldInstall()
    run('--apply', '--prune')

    expect(readFileSync(resolve(root, 'data/db/bkd.db'), 'utf8')).toBe('sqlite-bytes')
    expect(readFileSync(resolve(root, 'data/uploads/note.txt'), 'utf8')).toBe('user file')
  })

  it('removes the launcher-owned directories only with --prune', () => {
    seedOldInstall()

    run('--apply')
    expect(existsSync(resolve(root, 'data/app'))).toBe(true)
    expect(existsSync(resolve(root, 'data/updates'))).toBe(true)

    run('--apply', '--force', '--prune')
    expect(existsSync(resolve(root, 'data/app'))).toBe(false)
    expect(existsSync(resolve(root, 'data/updates'))).toBe(false)
  })

  it('warns instead of silently dropping a custom data location', () => {
    seedOldInstall()
    const proc = Bun.spawnSync(['bun', SCRIPT, '--root', root, '--apply'], {
      env: { ...process.env, BKD_DATA_DIR: '/srv/bkd-data' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(proc.exitCode).toBe(0)
    expect(proc.stdout.toString()).toContain('BKD_DATA_DIR=/srv/bkd-data')
  })

  // Pre-lode BKD selected its update with
  //   name.startsWith('bkd-app') && name.endsWith('.tar.gz')
  // and the pre-lode launcher with /^bkd-app-v\d+\.\d+\.\d+\.tar\.gz$/.
  // If the asset name ever matches either again, un-migrated installs would download a
  // package they cannot supervise or update. Binary-mode installs skipped .tar.gz assets,
  // so the extension keeps them out on its own.
  it('names the asset so pre-lode installs cannot select it', () => {
    seedOldInstall()
    run('--apply')

    const asset = readFileSync(resolve(root, 'lode.toml'), 'utf8')
      .match(/^asset\s*=\s*"([^"]+)"/m)?.[1]

    expect(asset).toBeDefined()
    expect(asset!.startsWith('bkd-app')).toBe(false)
    expect(/^bkd-app-v\d+\.\d+\.\d+\.tar\.gz$/.test(asset!)).toBe(false)
    expect(asset!.endsWith('.tar.gz')).toBe(true)
    expect(readFileSync(TEMPLATE, 'utf8')).toContain(`asset   = "${asset}"`)
  })

  // docs/bkd.lode.toml ships as a release asset for operators who cannot run the
  // script; the two configs must not drift apart.
  it('generates the same options as the published lode.toml template', () => {
    seedOldInstall()
    run('--apply')

    const keys = (toml: string) =>
      toml
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^\[|^[a-z_]+\s*=/.test(line))
        .map(line => (line.startsWith('[') ? line : line.split('=')[0].trim()))

    expect(keys(readFileSync(resolve(root, 'lode.toml'), 'utf8'))).toEqual(
      keys(readFileSync(TEMPLATE, 'utf8')),
    )
  })

  it('refuses to run when no launcher install is detected', () => {
    const { exitCode, stderr } = run('--apply')

    expect(exitCode).toBe(1)
    expect(stderr).toContain('No launcher install found')
    expect(existsSync(resolve(root, 'lode.toml'))).toBe(false)
  })

  it('migrates an install without a version pointer when forced', () => {
    const { exitCode } = run('--apply', '--force')

    expect(exitCode).toBe(0)
    expect(existsSync(resolve(root, 'lode.toml'))).toBe(true)
  })

  it('refuses to overwrite an existing lode.toml unless forced', () => {
    seedOldInstall()
    writeFileSync(resolve(root, 'lode.toml'), '# hand-tuned by the operator\n')

    const first = run('--apply')
    expect(first.exitCode).toBe(1)
    expect(first.stderr).toContain('already exists')
    expect(readFileSync(resolve(root, 'lode.toml'), 'utf8')).toContain('hand-tuned')

    const second = run('--apply', '--force')
    expect(second.exitCode).toBe(0)
    expect(readFileSync(resolve(root, 'lode.toml'), 'utf8')).toContain('[global]')
  })
})

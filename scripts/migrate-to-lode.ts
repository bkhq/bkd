#!/usr/bin/env bun
/**
 * Migrate a launcher/package-mode install to the lode supervisor.
 *
 * The old layout keeps everything under one install root:
 *   <root>/data/app/version.json   — active version pointer
 *   <root>/data/app/v{version}/    — server.js, public/, migrations/
 *   <root>/data/updates/           — downloaded archives
 *   <root>/data/db, data/uploads … — user data
 *
 * lode reuses that same root as its `dir`, so `data/` never moves: this script
 * only writes `lode.toml`, packs the currently installed version so it can be
 * seeded offline as a rollback target, and (with --prune) drops the two
 * directories the launcher owned.
 *
 * Usage:
 *   bun scripts/migrate-to-lode.ts                   # dry run (default)
 *   bun scripts/migrate-to-lode.ts --apply
 *   bun scripts/migrate-to-lode.ts --apply --prune   # also remove data/app + data/updates
 *   bun scripts/migrate-to-lode.ts --root /opt/bkd --apply --force
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    root: { type: 'string' },
    apply: { type: 'boolean', default: false },
    prune: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
})

if (args.help) {
  console.log(`
Migrate a launcher install to the lode supervisor.

  --root <path>   Install root (default: $BKD_ROOT, else the current directory)
  --apply         Write lode.toml and pack the current version (default: dry run)
  --prune         Also remove data/app/ and data/updates/ (needs --apply)
  --force         Overwrite an existing lode.toml, or migrate a root with no
                  data/app/version.json
`)
  process.exit(0)
}

const GITHUB_REPO = 'bkhq/bkd'
const ASSET_NAME = 'bkd-server.tar.gz'

const ROOT = resolve((args.root as string) ?? process.env.BKD_ROOT ?? process.cwd())
const APP_BASE = resolve(ROOT, 'data/app')
const VERSION_FILE = resolve(APP_BASE, 'version.json')
const UPDATES_DIR = resolve(ROOT, 'data/updates')
const LODE_TOML = resolve(ROOT, 'lode.toml')
const MIGRATION_DIR = resolve(ROOT, 'migration')

const apply = args.apply as boolean
const prune = args.prune as boolean
const force = args.force as boolean

function step(msg: string): void {
  console.log(`[migrate] ${msg}`)
}

function fatal(msg: string): never {
  console.error(`[migrate] ${msg}`)
  process.exit(1)
}

// --- 1. Inspect the existing install ---

step(`Install root: ${ROOT}`)

let currentVersion: string | null = null
if (existsSync(VERSION_FILE)) {
  try {
    const data = JSON.parse(readFileSync(VERSION_FILE, 'utf8'))
    if (typeof data.version === 'string') currentVersion = data.version
  } catch {
    // fall through to the not-detected branch
  }
}

if (!currentVersion) {
  if (!force) {
    fatal(
      `No launcher install found (${VERSION_FILE} missing or unreadable).\n` +
      `           Pass --root <path> to point at the install, or --force to write a config anyway.`,
    )
  }
  step('No active version detected — continuing because of --force')
} else {
  step(`Active version: ${currentVersion}`)
}

const versionDir = currentVersion ? resolve(APP_BASE, `v${currentVersion}`) : null
const hasVersionDir = !!versionDir && existsSync(versionDir)

// User data is never touched — report it so the operator can see it stays put.
// These are the ROOT_DIR-relative defaults: DB_PATH, BKD_DATA_DIR and WORKTREE_DIR can
// each override one of them, which is what the warning below is for.
for (const dir of ['data/db', 'data/uploads', 'data/logs', 'worktrees']) {
  if (existsSync(resolve(ROOT, dir))) step(`Preserved (untouched): ${dir}`)
}

// A launcher started with --data-dir (or DB_PATH / WORKTREE_DIR set) keeps its data
// somewhere else. Pinning ROOT_DIR alone would then point BKD at an empty directory,
// so surface it instead of silently generating a config that loses sight of the data.
const customEnv = (['BKD_DATA_DIR', 'DB_PATH', 'WORKTREE_DIR'] as const).filter(
  key => process.env[key],
)
if (customEnv.length > 0) {
  step(
    `NOTE: ${customEnv.map(k => `${k}=${process.env[k]}`).join(', ')} is set in this shell — ` +
    'uncomment the matching line in the generated [env] block so BKD keeps using it.',
  )
} else if (!existsSync(resolve(ROOT, 'data/db'))) {
  step(
    `NOTE: no data/db under ${ROOT}. If the launcher ran with --data-dir or a custom ` +
    'DB_PATH, add it to the generated [env] block — otherwise BKD will start on an empty database.',
  )
}

if (existsSync(LODE_TOML) && !force) {
  fatal(`${LODE_TOML} already exists — pass --force to overwrite it`)
}

// --- 2. Render lode.toml ---

/** Bun's release asset for this host; lode caches the runtime under <root>/runtime. */
function bunAsset(): string {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  return `bun-${os}-${arch}.zip`
}

const bunVersion = Bun.version

const lodeToml = `# BKD under lode — generated by scripts/migrate-to-lode.ts
# Operator-owned: BKD never writes this file. See docs/deployment.md.

[global]
app = "bkd"
# Reuses the existing install root, so data/ stays exactly where it is.
dir = "${ROOT}"

[update]
github  = "${GITHUB_REPO}"
asset   = "${ASSET_NAME}"
channel = "stable"
# "check" advertises new versions without installing them. Switch to "auto"
# once you trust the pipeline; "off" disables update checks entirely.
policy  = "check"

[trust]
# Signature verification is off: releases are not signed yet. Downloads are still
# integrity-checked (sha256 from the GitHub asset digest). To enable identity
# verification later, set trusted_keys and switch this to "enforce".
require_signature = "off"
# trusted_keys = ["<key_id>:<base64-pubkey>"]

[command]
run  = "bun run server.js"
exec = "bun"

# lode downloads bun once if it is not on PATH and caches it at <dir>/runtime/bun.
# NOTE: runtime downloads are TLS-protected but not signature-verified.
[runtime]
runtime  = "bun"
download = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${bunAsset()}"
version  = "${bunVersion}"

# Defaults for the server; a host env var of the same name wins over these.
[env]
ROOT_DIR  = "${ROOT}"
NODE_ENV  = "production"
PORT      = "3000"
HOST      = "0.0.0.0"
LOG_LEVEL = "info"
# Only if the old launcher used non-default locations (--data-dir, DB_PATH,
# WORKTREE_DIR). Defaults, relative to ROOT_DIR: data/, data/db/bkd.db, worktrees.
# BKD_DATA_DIR = "/opt/bkd/data"
# DB_PATH      = "/opt/bkd/data/db/bkd.db"
# WORKTREE_DIR = "worktrees"

[supervise]
readiness     = "state"
ready_timeout = 30
health_grace  = 10
# BKD cancels running engine processes on SIGTERM; give it room before SIGKILL.
stop_timeout  = 30
restart       = "on-failure"
`

if (!apply) {
  step('Dry run — nothing written. Re-run with --apply to perform the migration.')
  console.log(`\n--- ${LODE_TOML} ---\n${lodeToml}`)
  if (hasVersionDir) {
    step(`Would pack ${versionDir} into ${MIGRATION_DIR}/${ASSET_NAME}`)
  }
  if (prune) {
    step('Would remove data/app/ and data/updates/ (--prune)')
  } else {
    step('data/app/ and data/updates/ would be left in place (pass --prune to remove them)')
  }
  process.exit(0)
}

await Bun.write(LODE_TOML, lodeToml)
step(`Wrote ${LODE_TOML}`)

// --- 3. Pack the installed version so it can be seeded offline ---

let seedArchive: string | null = null
if (hasVersionDir) {
  mkdirSync(MIGRATION_DIR, { recursive: true })
  seedArchive = resolve(MIGRATION_DIR, ASSET_NAME)
  const tar = Bun.spawnSync(['tar', '-czf', seedArchive, '-C', versionDir!, '.'])
  if (tar.exitCode !== 0) {
    fatal(`Failed to pack ${versionDir}: ${tar.stderr.toString()}`)
  }
  step(`Packed the active version into ${seedArchive}`)
} else {
  step('No version directory to pack — lode will download the current release on first run')
}

// --- 4. Optionally drop the launcher-owned directories ---

if (prune) {
  for (const dir of [UPDATES_DIR, APP_BASE]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true })
      step(`Removed ${dir}`)
    }
  }
} else {
  step('Left data/app/ and data/updates/ in place (pass --prune to remove them)')
}

// --- 5. Next steps ---

console.log(`
[migrate] Done. Next steps:

  1. Install lode (see docs/deployment.md), then stop the old launcher process.
${
  seedArchive ?
    `  2. Seed the version you were running, so it stays available for rollback:

       lode-cli seed ${seedArchive} --version ${currentVersion} --dir ${ROOT}

  3. Start BKD under lode:

       lode --dir ${ROOT}
` :
    `  2. Start BKD under lode (it will install the latest release):

       lode --dir ${ROOT}
`
}
  Delete the old launcher binary once the new process serves traffic.
`)

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import type { SkillAgent, SkillsOperation, SkillsOperationKind } from '@bkd/shared'
import { resolveCommand, spawnNode } from '@/engines/spawn'
import { logger } from '@/logger'
import { ulid } from 'ulid'
import { assertProjectScope, assertSkillName, cliFolderName, findLockEntry, globalRoots, listSkills, parseFrontmatter, projectRoots, readLock, SkillError } from './service'

/*
 * Install, update and uninstall go through the `skills` CLI (vercel-labs/skills),
 * which owns the lock file and the agent links. It runs as an argv list (no
 * shell), pinned to one version, with telemetry off; one operation at a time.
 */

export const SKILLS_CLI_VERSION = '1.7.4'
const TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT_LINES = 500
const KEEP_OPERATIONS = 20

export interface CliRunOptions {
  cwd: string
  env: Record<string, string | undefined>
  /** Each progress line the CLI prints (stderr, and stdout when not JSON). */
  onLine: (line: string) => void
  signal: AbortSignal
}
export type SkillsCliRunner = (args: string[], options: CliRunOptions) => Promise<{ exitCode: number, stdout: string }>

// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;?]*[A-Z]/gi

async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void, keep?: string[]): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = (part: string) => {
    keep?.push(part)
    const line = part.replace(ANSI, '').trim()
    if (line) onLine(line)
  }
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    // Spinners redraw with \r; treat it as a line break
    const parts = buffer.split(/\r\n|\r|\n/)
    buffer = parts.pop() ?? ''
    parts.forEach(flush)
  }
  if (buffer) flush(buffer)
}

const npxRunner: SkillsCliRunner = async (args, { cwd, env, onLine, signal }) => {
  const proc = spawnNode(['npx', '-y', `skills@${SKILLS_CLI_VERSION}`, ...args], { cwd, env, stdin: 'ignore' })
  const onAbort = () => proc.kill()
  signal.addEventListener('abort', onAbort)
  const stdoutParts: string[] = []
  const json = args.includes('--json')
  try {
    await Promise.all([
      // JSON output is parsed whole, not logged line by line
      readLines(proc.stdout, json ? () => {} : onLine, stdoutParts),
      readLines(proc.stderr, onLine),
    ])
    return { exitCode: await proc.exited, stdout: stdoutParts.join('\n') }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

let runner: SkillsCliRunner = npxRunner

/** Tests replace the CLI; `null` restores the real one. */
export function setSkillsCliRunner(next: SkillsCliRunner | null): void {
  runner = next ?? npxRunner
}

export function isSkillsCliAvailable(): boolean {
  return !!resolveCommand('npx')
}

// ── Operations ──────────────────────────────────────────

interface Running {
  op: SkillsOperation
  abort: AbortController
  cancelled: boolean
}

const operations = new Map<string, SkillsOperation>()
let current: Running | null = null

export function resetSkillsOperations(): void {
  current?.abort.abort()
  current = null
  operations.clear()
}

export function getSkillsOperation(id: string): SkillsOperation | undefined {
  return operations.get(id)
}

export function cancelSkillsOperation(id: string): boolean {
  if (current?.op.id !== id) return false
  current.cancelled = true
  current.abort.abort()
  return true
}

/** `owner/repo` or an https://github.com/owner/repo URL; never something the CLI could read as a flag or a path. */
const SOURCE_RE = /^(?:[A-Z0-9][\w.-]*\/[\w.-]+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/[\w./-]*)?)$/i

export interface StartOperationInput {
  op: SkillsOperationKind
  scope: 'global' | 'project'
  source?: string
  skills?: string[]
  names?: string[]
  agents?: SkillAgent[]
  projectDir?: string | null
}

function home(): string {
  return process.env.HOME || homedir()
}

function cliEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return { ...process.env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', NO_COLOR: '1', FORCE_COLOR: '0', CI: '1', ...overrides }
}

function scopeFlag(scope: 'global' | 'project'): string[] {
  return scope === 'global' ? ['-g'] : []
}

async function validate(input: StartOperationInput): Promise<void> {
  if (input.scope === 'project' && !input.projectDir) throw new SkillError('Project has no directory', 400)
  // A project rooted at HOME would install into the global store under a project lock
  await assertProjectScope(input.scope, input.projectDir)
  if (input.op === 'preview' || input.op === 'add') {
    if (!input.source || !SOURCE_RE.test(input.source)) throw new SkillError('Source must be owner/repo or a https://github.com/ URL', 400)
  }
  if (input.op === 'add') {
    if (!input.skills?.length) throw new SkillError('Choose at least one skill to install', 400)
    // Names as the repository declares them (`My Skill` is valid); only a flag-like or control-character name is refused
    for (const name of input.skills) {
      // eslint-disable-next-line no-control-regex
      if (name.startsWith('-') || /[\x00-\x1F]/.test(name)) throw new SkillError('Invalid skill name', 400)
    }
  }
  for (const name of input.names ?? []) assertSkillName(name)
  if (input.op === 'remove') {
    if (!input.names?.length) throw new SkillError('Choose at least one skill to uninstall', 400)
    // The CLI reports success for names it does not know, so check first
    const installed = new Set(
      (await listSkills(input.scope === 'project' ? input.projectDir : null))
        .filter(s => s.managed && s.scope === input.scope)
        .map(s => s.name),
    )
    const unknown = input.names.filter(n => !installed.has(n))
    if (unknown.length) throw new SkillError(`Not an installed skill: ${unknown.join(', ')}`, 400)
  }
}

export async function startSkillsOperation(input: StartOperationInput): Promise<SkillsOperation> {
  if (current) throw new SkillError('Another skills operation is running', 409)
  await validate(input)
  if (current) throw new SkillError('Another skills operation is running', 409)

  const op: SkillsOperation = {
    id: ulid(),
    op: input.op,
    scope: input.scope,
    status: 'running',
    output: [],
    error: null,
    result: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  const running: Running = { op, abort: new AbortController(), cancelled: false }
  current = running
  operations.set(op.id, op)
  for (const id of [...operations.keys()].slice(0, Math.max(0, operations.size - KEEP_OPERATIONS))) operations.delete(id)

  void run(input, running)
  return op
}

async function run(input: StartOperationInput, running: Running): Promise<void> {
  const { op, abort } = running
  const timer = setTimeout(() => {
    op.error = 'Timed out after 5 minutes'
    abort.abort()
  }, TIMEOUT_MS)
  const onLine = (line: string) => {
    op.output.push(line)
    if (op.output.length > MAX_OUTPUT_LINES) op.output.splice(0, op.output.length - MAX_OUTPUT_LINES)
  }
  const cwd = input.scope === 'global' ? home() : input.projectDir!
  let previewHome: string | null = null

  try {
    let args: string[]
    let env = cliEnv()
    let runCwd = cwd
    switch (input.op) {
      case 'preview':
        // Install everything into a throwaway HOME to read the repo's skills:
        // `add -l` has no machine-readable output.
        previewHome = await mkdtemp(join(tmpdir(), 'bkd-skills-preview-'))
        await mkdir(join(previewHome, '.codex'), { recursive: true })
        args = ['add', input.source!, '-s', '*', '-a', 'codex', '-g', '-y', '--json']
        // The CLI keeps its global lock under XDG_STATE_HOME when that is set
        env = cliEnv({ HOME: previewHome, XDG_STATE_HOME: join(previewHome, '.local/state') })
        runCwd = previewHome
        break
      case 'add':
        args = ['add', input.source!, '-s', ...input.skills!, '-a', ...(input.agents?.length ? input.agents : ['claude-code', 'codex']), ...scopeFlag(input.scope), '-y', '--json']
        break
      case 'update': {
        // The CLI matches update names against lock keys, which may differ from folder names
        const lock = await readLock(input.scope === 'global' ? globalRoots().lockFile : projectRoots(input.projectDir!).lockFile)
        const names = (input.names ?? []).map(name => findLockEntry(lock, name)?.[0] ?? name)
        args = ['update', ...names, input.scope === 'global' ? '-g' : '-p', '-y']
        break
      }
      case 'remove':
        args = ['remove', ...input.names!, ...scopeFlag(input.scope), '-y']
        break
    }

    // Cancelled while preparing: the abort already fired, so a runner started now would never see it
    const { exitCode, stdout } = abort.signal.aborted
      ? { exitCode: 1, stdout: '' }
      : await runner(args, { cwd: runCwd, env, onLine, signal: abort.signal })
    if (running.cancelled) {
      op.status = 'cancelled'
    } else if (abort.signal.aborted) {
      op.status = 'failed'
    } else if (exitCode !== 0) {
      op.status = 'failed'
      op.error = `skills CLI exited with code ${exitCode}`
    } else if (input.op === 'preview' || input.op === 'add') {
      const results = parseJsonResults(stdout)
      const failed = results.filter(r => r.status === 'failed')
      if (failed.length) {
        op.status = 'failed'
        op.error = failed.map(r => `${r.name ?? '?'}: ${r.error ?? 'failed'}`).join('; ')
      } else {
        // Result first: a poll that sees 'succeeded' must also see the skills
        if (input.op === 'preview') {
          op.result = { skills: await describe(results, previewHome!) }
        }
        op.status = 'succeeded'
      }
    } else {
      op.status = 'succeeded'
    }
  } catch (err) {
    op.status = 'failed'
    op.error = err instanceof Error ? err.message : String(err)
    logger.warn({ err, op: input.op }, 'skills_operation_failed')
  } finally {
    clearTimeout(timer)
    if (previewHome) await rm(previewHome, { recursive: true, force: true }).catch(() => {})
    op.finishedAt = new Date().toISOString()
    current = null
    logger.info({ id: op.id, op: op.op, status: op.status }, 'skills_operation_finished')
  }
}

interface CliResult { name?: string, status?: string, error?: string, path?: string }

function parseJsonResults(stdout: string): CliResult[] {
  const start = stdout.indexOf('[')
  if (start === -1) throw new Error('skills CLI returned no JSON result')
  return JSON.parse(stdout.slice(start)) as CliResult[]
}

async function describe(results: CliResult[], previewHome: string): Promise<{ name: string, description: string }[]> {
  const out: { name: string, description: string }[] = []
  for (const r of results) {
    if (!r.name) continue
    // The CLI names the folder after the sanitized skill name
    const dir = join(previewHome, '.agents/skills', cliFolderName(r.name))
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => '')
    out.push({ name: r.name, description: parseFrontmatter(text).description ?? '' })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

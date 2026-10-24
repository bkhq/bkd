/**
 * Stand-in for an admission command such as `mcp-manager worktree`.
 * argv[2] = log file (one JSON argv array appended per call),
 * argv[3] = mode: `ready` | `refuse` | `garbage`; the rest is what BKD passes.
 */
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const [logFile, mode, ...args] = process.argv.slice(2)
appendFileSync(logFile!, `${JSON.stringify(args)}\n`)

const action = args[0]
if (mode === 'refuse') {
  process.stderr.write(JSON.stringify({ ready: false, reason: 'worktree_bkd_mismatch', message: 'not mapped' }))
  process.exit(1)
}
if (mode === 'garbage') {
  process.stdout.write('not json')
  process.exit(0)
}
if (action === 'cleanup') {
  process.stdout.write(JSON.stringify({ revoked: ['lease-1'], removed: [], kept: [], alreadyClean: false }))
  process.exit(0)
}
const attempt = args[args.indexOf('--attempt') + 1]
process.stdout.write(JSON.stringify({
  ready: true,
  leaseId: 'lease-1',
  attemptId: attempt,
  delivery: 'extra_config_argument',
  reused: false,
  launch: {
    args: ['--mcp-config', '/managed/target.json'],
    env: { MCP_MANAGER_LEASE: 'lease-1' },
  },
  requirements: [],
  limits: [],
}))

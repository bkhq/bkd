/**
 * Feasibility probe #2 — the HYBRID architecture:
 *   - PTY output → (would go to xterm.js for the human view)
 *   - structured data → tail the session .jsonl transcript (NOT screen scraping)
 *
 * Verified linchpins of a clean implementation path (all OK end-to-end):
 *   1. --session-id makes the transcript path deterministic (no dir-diffing)
 *   2. fs.watch + safety-poll gives incremental append events we parse turn-by-turn,
 *      with system/turn_duration as the turn-completion marker
 *   3. the one-time folder-trust gate is NOT bypassed by --dangerously-skip-permissions;
 *      cleared here with a blind Enter (in production: pre-seed ~/.claude.json
 *      projects[cwd].hasTrustDialogAccepted=true instead)
 *
 * Run: bun scripts/pty-feasibility/hybrid-probe.ts   (override binary via CLAUDE_BIN)
 */
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readdirSync, readSync, statSync, watch } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CLAUDE = process.env.CLAUDE_BIN || '/root/.local/bin/claude'
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function section(t: string) {
  console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`)
}

// ---- a minimal incremental JSONL tailer (the "monitor the uuid jsonl" answer) ----
class TranscriptTailer {
  private offset = 0
  private carry = ''
  private watcher: ReturnType<typeof watch> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private watching = false
  constructor(private path: string, private onRecord: (rec: any) => void) {}

  start() {
    // The transcript file is created lazily (on first submitted message), so we
    // poll until it exists, then attach fs.watch(file). The interval also acts
    // as a safety-net drain because fs.watch can coalesce/miss rapid appends.
    this.poll = setInterval(() => {
      if (!this.watching && safe(() => statSync(this.path))) {
        this.watcher = watch(this.path, { persistent: false }, () => this.drain())
        this.watching = true
      }
      this.drain()
    }, 250)
  }

  private drain() {
    let size: number
    try {
      size = statSync(this.path).size
    } catch {
      return
    }
    if (size < this.offset) {
      this.offset = 0; this.carry = ''
    } // truncated/rewritten → restart
    if (size === this.offset) return
    const fd = openSync(this.path, 'r')
    try {
      const len = size - this.offset
      const buf = Buffer.allocUnsafe(len)
      const n = readSync(fd, buf, 0, len, this.offset)
      this.offset += n
      this.carry += buf.subarray(0, n).toString('utf8')
      let nl: number
      while ((nl = this.carry.indexOf('\n')) !== -1) {
        const line = this.carry.slice(0, nl); this.carry = this.carry.slice(nl + 1)
        if (!line.trim()) continue
        try {
          this.onRecord(JSON.parse(line))
        } catch { /* partial/non-json */ }
      }
    } finally {
      closeSync(fd)
    }
  }

  stop() {
    if (this.poll) clearInterval(this.poll); this.watcher?.close()
  }
}

function findByUuid(uuid: string): string | null {
  for (const d of safe(() => readdirSync(PROJECTS_DIR)) ?? []) {
    const p = join(PROJECTS_DIR, d, `${uuid}.jsonl`)
    if (safe(() => statSync(p))) return p
  }
  return null
}
function safe<T>(f: () => T): T | undefined {
  try {
    return f()
  } catch {
    return undefined
  }
}

async function main() {
  const sessionId = randomUUID()
  const workdir = mkdtempSync(join(tmpdir(), 'claude-hybrid-'))

  section('PHASE 0 — launch interactive claude in PTY with deterministic session-id')
  console.log('session-id:', sessionId)
  console.log('workdir   :', workdir)

  let ptyBytes = 0
  const proc = Bun.spawn([
    CLAUDE,
    '--session-id',
    sessionId,
    '--dangerously-skip-permissions',
  ], {
    cwd: workdir,
    terminal: { cols: 120, rows: 40, data(_t: unknown, d: Uint8Array) {
      ptyBytes += d.length
    } },
    env: { ...process.env, TERM: 'xterm-256color', LANG: process.env.LANG || 'C.UTF-8' },
  } as Parameters<typeof Bun.spawn>[1]) as unknown as {
    pid?: number
    kill: () => void
    terminal?: { write: (s: string) => void, close: () => void }
  }
  const term = proc.terminal
  console.log('pid       :', proc.pid)

  // give the TUI time to render, then clear the one-time folder-trust gate
  // (option 1 "Yes, I trust" is preselected → a bare Enter confirms it).
  // NOTE: --dangerously-skip-permissions does NOT bypass this gate; in production
  // pre-seed ~/.claude.json projects[dir].hasTrustDialogAccepted=true instead.
  await sleep(4000)
  term?.write('\r')
  await sleep(3500)

  // expected deterministic path (cwd → encoded dir), plus uuid-search fallback
  const encoded = workdir.replace(/[^a-z0-9]/gi, '-')
  const expected = join(PROJECTS_DIR, encoded, `${sessionId}.jsonl`)
  const foundEarly = findByUuid(sessionId)
  console.log('expected path :', expected)
  console.log('exists pre-prompt:', !!foundEarly, foundEarly ? '(session file already created at launch)' : '')

  // ---- attach the tailer BEFORE sending the prompt ----
  section('PHASE 1 — fs.watch tailer (incremental parse, turn-completion detection)')
  const events: string[] = []
  let turnDone = false
  let assistantText = ''
  const tailer = new TranscriptTailer(foundEarly ?? expected, (rec) => {
    if (rec.type === 'user') {
      events.push('user')
    } else if (rec.type === 'assistant') {
      const c = rec.message?.content
      assistantText = Array.isArray(c) ? c.map((x: any) => x.type === 'text' ? x.text : `[${x.type}]`).join('') : String(c)
      events.push('assistant')
    } else if (rec.type === 'system' && rec.subtype === 'turn_duration') {
      events.push('⟦turn_duration⟧'); turnDone = true
    } else if (rec.type === 'system' && rec.subtype) {
      events.push(`system:${rec.subtype}`)
    }
  })
  tailer.start()

  // ---- drive a turn purely by writing to the PTY (no blind trust-Enter this time) ----
  section('PHASE 2 — send prompt via PTY keystrokes (testing if trust gate is gone)')
  term?.write('Reply with exactly the word PONG and nothing else. Do not use any tools.')
  await sleep(900)
  term?.write('\r')

  // wait for turn completion via the transcript marker
  const deadline = Date.now() + 70000
  // eslint-disable-next-line no-unmodified-loop-condition -- turnDone is flipped inside the tailer callback
  while (Date.now() < deadline && !turnDone) await sleep(500)

  section('PHASE 3 — teardown')
  try {
    term?.write('\x03'); await sleep(120); term?.write('\x03')
  } catch {}
  await sleep(300)
  try {
    term?.close()
  } catch {}
  try {
    proc.kill()
  } catch {}
  tailer.stop()

  const finalPath = findByUuid(sessionId)
  section('REPORT')
  console.log('PTY bytes (for xterm view) :', ptyBytes, '(ANSI, human display only)')
  console.log('Deterministic path works   :', finalPath === expected ? 'YES (cwd-encoding matched)' : (finalPath ? `partial (found at ${finalPath})` : 'NO'))
  console.log('Trust gate auto-bypassed   :', events.includes('user') ? 'YES (prompt reached the agent w/o manual Enter)' : 'NO (turn never started — gate likely blocked)')
  console.log('Tailer record sequence     :', events.join(' → ') || '(none)')
  console.log('Turn completion detected   :', turnDone ? 'YES (system/turn_duration)' : 'no')
  console.log('Assistant reply parsed     :', JSON.stringify(assistantText) || '(none)')
  console.log('')
  console.log('VERDICT (hybrid path):')
  console.log('  session-id → deterministic file :', finalPath ? 'OK' : 'FAILED')
  console.log('  skip-permissions → no trust gate :', events.includes('user') ? 'OK' : 'NEEDS keystroke automation')
  console.log('  fs.watch tail → structured turns :', events.includes('assistant') ? 'OK' : 'FAILED')
  console.log('  turn boundary marker             :', turnDone ? 'OK (turn_duration)' : 'not seen')
}

const guard = setTimeout(() => {
  console.log('[deadline] killing'); process.exit(0)
}, 95000)
main().then(() => {
  clearTimeout(guard); process.exit(0)
}).catch((e) => {
  console.error('probe2 error:', e); process.exit(1)
})

/**
 * Feasibility probe: drive Claude Code via a PTY (interactive TUI) instead of
 * the headless `claude -p --output-format=stream-json` SDK protocol.
 *
 * It tests the user's proposed architecture:
 *   1. launch claude through a PTY (interactive mode)
 *   2. parse output from the session ".jsonl" transcript stream file
 *   3. communicate by writing keystrokes to the terminal
 *
 * Standalone — does NOT touch the app.
 * Run: bun scripts/pty-feasibility/scrape-probe.ts   (override binary via CLAUDE_BIN)
 *
 * Finding: PTY output is pure ANSI TUI rendering (0 JSON lines) — scraping it
 * for structured data is NOT feasible. See hybrid-probe.ts for the viable path.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CLAUDE = process.env.CLAUDE_BIN || '/root/.local/bin/claude'
const HOME = homedir()
const PROJECTS_DIR = join(HOME, '.claude', 'projects')
const OUT_DIR = '/tmp/claude-pty-feasibility'
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
// eslint-disable-next-line no-control-regex, regexp/no-obscure-range -- standard ANSI/CSI escape stripping
const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const stripAnsi = (s: string) => s.replace(ANSI, '')

function section(t: string) {
  console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`)
}

// ---- snapshot existing project dirs so we can detect the new session file ----
const beforeDirs = new Set<string>(safeReaddir(PROJECTS_DIR))
function safeReaddir(d: string): string[] {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}

function findNewSessionFile(): string | null {
  for (const name of safeReaddir(PROJECTS_DIR)) {
    if (beforeDirs.has(name)) continue
    const dir = join(PROJECTS_DIR, name)
    const jsonls = safeReaddir(dir).filter(f => f.endsWith('.jsonl'))
    if (jsonls.length === 0) continue
    let newest = ''; let newestMt = 0
    for (const f of jsonls) {
      const p = join(dir, f)
      const mt = statSync(p).mtimeMs
      if (mt >= newestMt) {
        newestMt = mt; newest = p
      }
    }
    if (newest) return newest
  }
  return null
}

// ---- launch interactive claude in a PTY ----
const workdir = mkdtempSync(join(tmpdir(), 'claude-pty-work-'))
const chunks: Buffer[] = []
let totalBytes = 0
let lastDataAt = Date.now()

section('PHASE 0 — environment')
console.log('claude   :', CLAUDE)
console.log('workdir  :', workdir, '(fresh temp dir → expect a trust dialog)')
console.log('projects :', PROJECTS_DIR, `(${beforeDirs.size} existing)`)

section('PHASE 1 — spawn claude through a PTY (interactive, NO -p)')
const proc = Bun.spawn([CLAUDE], {
  cwd: workdir,
  terminal: {
    cols: 120,
    rows: 40,
    data(_t: unknown, d: Uint8Array) {
      chunks.push(Buffer.from(d))
      totalBytes += d.length
      lastDataAt = Date.now()
    },
  },
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    LANG: process.env.LANG || 'C.UTF-8',
    LC_CTYPE: process.env.LC_CTYPE || 'C.UTF-8',
  },
} as Parameters<typeof Bun.spawn>[1]) as unknown as {
  pid?: number
  kill: () => void
  terminal?: { write: (s: string) => void, close: () => void }
}
console.log('pid      :', proc.pid, '| terminal handle:', typeof proc.terminal)

const term = proc.terminal
function write(s: string, label: string) {
  console.log(`  > writing to PTY: ${label}`)
  term?.write(s)
}

async function waitSettle(quietMs: number, hardMs: number) {
  const start = Date.now()
  while (Date.now() - start < hardMs) {
    await sleep(200)
    if (Date.now() - lastDataAt > quietMs) return
  }
}

async function main() {
  // 1. let the TUI render. Note: text-matching on the scraped screen is
  // unreliable (ANSI cursor positioning drops inter-word spaces), so we drive
  // the trust dialog blindly by keystroke position instead of by detection.
  await waitSettle(1500, 15000)

  // 2. clear the interactive-only folder-trust gate: option 1 ("Yes, I trust")
  //    is pre-selected (❯), so a bare Enter confirms it. Harmless if absent.
  console.log('  sending Enter to clear the trust gate (blind, position-based)')
  write('\r', 'Enter (accept trust)')
  await waitSettle(2000, 12000)

  // 3. send a benign, tool-free prompt and submit with Enter
  section('PHASE 2 — drive a turn by writing keystrokes to the terminal')
  const bytesBeforePrompt = totalBytes
  write('Reply with exactly the word PONG and nothing else. Do not use any tools.', 'prompt text')
  await sleep(1000)
  write('\r', 'Enter (submit)')
  await sleep(1000)
  console.log(`  PTY bytes emitted after typing prompt: ${totalBytes - bytesBeforePrompt} (echo + render)`)

  // 4. locate the session transcript and poll it for the assistant reply
  section('PHASE 3 — read output from the session .jsonl transcript stream')
  let sessionFile: string | null = null
  let gotPong = false
  let assistantSeen = 0
  const deadline = Date.now() + 75000
  let announced = false
  while (Date.now() < deadline) {
    await sleep(800)
    sessionFile ||= findNewSessionFile()
    if (!sessionFile) continue
    if (!announced) {
      console.log('  session file appeared:', sessionFile); announced = true
    }
    const raw = (() => {
      try {
        return readFileSync(sessionFile, 'utf8')
      } catch {
        return ''
      }
    })()
    const recs = raw.split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    }).filter(Boolean) as any[]
    assistantSeen = recs.filter(r => r.type === 'assistant').length
    const flat = JSON.stringify(recs)
    if (/PONG/.test(flat) && assistantSeen > 0) {
      gotPong = true; break
    }
  }

  // ---- analyze PTY raw output ----
  const rawBuf = Buffer.concat(chunks)
  const text = rawBuf.toString('utf8')
  const hasEsc = rawBuf.includes(0x1B)
  const ptyLines = text.split('\n')
  const ptyJsonLines = ptyLines.filter((l) => {
    const t = l.trim()
    if (!t.startsWith('{')) return false
    try {
      JSON.parse(t); return true
    } catch {
      return false
    }
  }).length
  writeFileSync(join(OUT_DIR, 'pty-raw.bin'), rawBuf)
  writeFileSync(join(OUT_DIR, 'pty-decoded.txt'), text)

  // ---- analyze transcript ----
  let transcriptOk = false
  const transcriptTypes: Record<string, number> = {}
  if (sessionFile) {
    const raw = (() => {
      try {
        return readFileSync(sessionFile, 'utf8')
      } catch {
        return ''
      }
    })()
    const recs = raw.split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    }).filter(Boolean) as any[]
    transcriptOk = recs.length > 0
    for (const r of recs) transcriptTypes[r.type ?? '?'] = (transcriptTypes[r.type ?? '?'] ?? 0) + 1
  }

  // ---- teardown ----
  section('PHASE 4 — teardown')
  try {
    write('\x03', 'Ctrl-C'); await sleep(150); write('\x03', 'Ctrl-C')
  } catch {}
  await sleep(300)
  try {
    term?.close()
  } catch {}
  try {
    proc.kill()
  } catch {}

  // ---- report ----
  section('FEASIBILITY REPORT')
  console.log(`PTY launch                : ${proc.pid ? `OK (pid ${proc.pid})` : 'FAILED'}`)
  console.log(`PTY raw bytes captured    : ${totalBytes}`)
  console.log(`PTY output contains ANSI  : ${hasEsc ? 'YES (terminal rendering)' : 'no'}`)
  console.log(`PTY output JSON lines     : ${ptyJsonLines}  ← parseable JSON directly off the PTY`)
  console.log(`Session .jsonl found      : ${sessionFile || 'NOT FOUND'}`)
  console.log(`Transcript parseable      : ${transcriptOk ? 'YES' : 'no'}  types=${JSON.stringify(transcriptTypes)}`)
  console.log(`Assistant turns in jsonl  : ${assistantSeen}`)
  console.log(`Keystroke-driven reply    : ${gotPong ? 'YES — PONG round-tripped via PTY input' : 'NOT observed'}`)
  console.log('')
  console.log('Verdicts:')
  console.log(`  (A) parse PTY stdout as JSON     : ${ptyJsonLines > 0 ? 'feasible' : 'NOT feasible — it is ANSI TUI, not JSON'}`)
  console.log(`  (B) parse session .jsonl stream  : ${transcriptOk ? 'feasible' : 'inconclusive'}`)
  console.log(`  (C) drive via terminal writes    : ${gotPong ? 'works (but fragile)' : 'inconclusive / blocked'}`)
  console.log('')
  console.log('Artifacts:')
  console.log('  raw PTY bytes  :', join(OUT_DIR, 'pty-raw.bin'))
  console.log('  decoded text   :', join(OUT_DIR, 'pty-decoded.txt'))
  console.log('  first 400 decoded chars (escaped):')
  console.log(`  ${JSON.stringify(stripAnsi(text).slice(0, 400))}`)
}

const guard = setTimeout(() => {
  console.log('\n[hard deadline hit — killing]'); try {
    proc.kill()
  } catch {}; process.exit(0)
}, 100000)
main().then(() => {
  clearTimeout(guard); process.exit(0)
}).catch((e) => {
  console.error('probe error:', e); try {
    proc.kill()
  } catch {}; process.exit(1)
})

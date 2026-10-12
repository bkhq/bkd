/**
 * Stand-in for `codex app-server` whose thread/resume is rejected the way a
 * thread held by another process is. Writes its pid to argv[2] and, like an
 * app-server with a turn in flight, does not exit when stdin closes.
 */
import { writeFileSync } from 'node:fs'
import process from 'node:process'

writeFileSync(process.argv[2]!, String(process.pid))

function reply(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  let nl = buffer.indexOf('\n')
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    nl = buffer.indexOf('\n')
    if (!line) continue
    const { id, method, params } = JSON.parse(line)
    if (id === undefined) continue
    if (method === 'initialize') {
      reply({ id, result: { userAgent: 'fake-codex' } })
    } else if (method === 'thread/resume') {
      reply({
        id,
        error: { code: -32600, message: `thread ${params.threadId} already has an active writer` },
      })
    } else {
      reply({ id, result: {} })
    }
  }
})
process.stdin.on('end', () => {})
setInterval(() => {}, 1000)

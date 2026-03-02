import { createConsola } from 'consola'
import { dbPath } from './db'
import { APP_DIR, ROOT_DIR } from './root'
import { COMMIT, VERSION } from './version'

const consola = createConsola()

function getMode(): string {
  if (APP_DIR) return 'package'
  if (import.meta.dir.startsWith('/$bunfs')) return 'compiled'
  return 'dev'
}

export function printStartupBanner(host: string, port: number) {
  const mode = getMode()
  const nodeEnv = process.env.NODE_ENV ?? 'development'

  consola.box(
    [
      `  bitk v${VERSION}${COMMIT !== 'dev' ? ` (${COMMIT.slice(0, 7)})` : ''}`,
      '',
      `  Mode:      ${mode}`,
      `  Env:       ${nodeEnv}`,
      `  Listen:    ${host}:${port}`,
      `  Root:      ${ROOT_DIR}`,
      `  Database:  ${dbPath}`,
      `  Runtime:   Bun ${Bun.version}`,
    ].join('\n'),
  )
}

import * as z from 'zod'

const runtimeSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  SERVICE_NAME: z.string().regex(/^[\w.-]+$/).default('bkd'),
  MAX_CONCURRENT_EXECUTIONS: z.coerce.number().int().min(1).default(5),
  WORKTREE_DIR: z.string().min(1).default('worktrees'),
  ALLOWED_ORIGIN: z.string().min(1).default('*').refine(value => value === '*' || value.split(',').every((origin) => {
    try {
      const url = new URL(origin.trim())
      return ['http:', 'https:'].includes(url.protocol) && url.origin === origin.trim()
    } catch {
      return false
    }
  }), 'ALLOWED_ORIGIN must be * or comma-separated HTTP origins'),
})

export function parseRuntimeConfig(env: Record<string, string | undefined>) {
  return runtimeSchema.parse(env)
}

export const runtimeConfig = parseRuntimeConfig(process.env)

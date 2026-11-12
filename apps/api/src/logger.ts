import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import pino from 'pino'
import { ulid } from 'ulid'
import { rotatingFileStream } from './log-rotation'
import { DATA_DIR } from './root'
import { runtimeConfig } from './runtime-config'

const level = runtimeConfig.LOG_LEVEL
const name = runtimeConfig.SERVICE_NAME

const logDir = join(DATA_DIR, 'logs')
mkdirSync(logDir, { recursive: true })

const logFile = join(logDir, `${name}.log`)

/** The log rotates at this size; with the rotated files it stays under ~300 MB. */
const LOG_MAX_BYTES = 50 * 1024 * 1024
const LOG_KEEP_FILES = 5

export const logger = pino(
  { level, base: undefined },
  pino.multistream([
    { level, stream: process.stdout },
    { level, stream: rotatingFileStream(logFile, { maxBytes: LOG_MAX_BYTES, keep: LOG_KEEP_FILES }) },
  ]),
)

export function httpLogger(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = ulid()
    const startedAt = performance.now()
    c.header('X-Request-ID', requestId)
    await next()
    if (c.req.path === '/api/health' || c.req.path === '/api/events') return
    logger.info({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
    }, 'http_request')
  }
}

import { zValidator } from '@hono/zod-validator'
import * as z from 'zod'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import {
  getUpgradeStatus,
  getVersionInfo,
  requestRestart,
  requestRollback,
  requestUpgrade,
} from '@/upgrade/service'

/** `latest` or a semver — the only values lode accepts as an update target. */
const versionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(?:latest|\d+\.\d+\.\d+)$/, 'Version must be "latest" or a semver like 1.2.3')

const upgrade = createOpenAPIRouter()

// GET /api/settings/upgrade/version — current version info
upgrade.get('/version', (c) => {
  return c.json({ success: true, data: getVersionInfo() })
})

// GET /api/settings/upgrade/status — supervisor state (version, availability, health)
upgrade.get('/status', (c) => {
  return c.json({ success: true, data: getUpgradeStatus() })
})

// POST /api/settings/upgrade/update — ask lode to install a version (default: latest)
upgrade.post(
  '/update',
  zValidator('json', z.object({ version: versionSchema.optional() }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  (c) => {
    const { version } = c.req.valid('json')
    try {
      requestUpgrade(version)
      return c.json({ success: true, data: { requested: version ?? 'latest' } })
    } catch (err) {
      logger.error({ err }, 'upgrade_request_failed')
      return c.json({ success: false, error: (err as Error).message }, 400)
    }
  },
)

// POST /api/settings/upgrade/rollback — go back to last-good (or an explicit version)
upgrade.post(
  '/rollback',
  zValidator('json', z.object({ version: versionSchema.optional() }), (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  (c) => {
    const { version } = c.req.valid('json')
    try {
      const target = requestRollback(version)
      return c.json({ success: true, data: { requested: target } })
    } catch (err) {
      logger.error({ err }, 'upgrade_rollback_failed')
      return c.json({ success: false, error: (err as Error).message }, 400)
    }
  },
)

// POST /api/settings/upgrade/restart — relaunch the current version
upgrade.post('/restart', (c) => {
  try {
    requestRestart()
    return c.json({ success: true, data: { status: 'restarting' } })
  } catch (err) {
    logger.error({ err }, 'upgrade_restart_failed')
    return c.json({ success: false, error: (err as Error).message }, 400)
  }
})

export default upgrade

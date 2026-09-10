import { UpgradeStatusSchema, VersionInfoSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
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
upgrade.openapi(createRoute({
  method: 'get',
  path: '/version',
  tags: ['Settings'],
  operationId: 'getSettingsUpgradeVersion',
  responses: {
    200: successResponse(VersionInfoSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), (c) => {
  return c.json({ success: true as const, data: getVersionInfo() }, 200)
})

// GET /api/settings/upgrade/status — supervisor state (version, availability, health)
upgrade.openapi(createRoute({
  method: 'get',
  path: '/status',
  tags: ['Settings'],
  operationId: 'getSettingsUpgradeStatus',
  responses: {
    200: successResponse(UpgradeStatusSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), (c) => {
  return c.json({ success: true as const, data: getUpgradeStatus() }, 200)
})

// POST /api/settings/upgrade/update — ask lode to install a version (default: latest)
upgrade.openapi(createRoute({
  method: 'post',
  path: '/update',
  tags: ['Settings'],
  operationId: 'postSettingsUpgradeUpdate',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ version: versionSchema.optional() }) } } } },
  responses: {
    200: successResponse(z.object({ requested: z.string() }), 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), (c) => {
  const { version } = c.req.valid('json')
  try {
    requestUpgrade(version)
    return c.json({ success: true as const, data: { requested: version ?? 'latest' } }, 200)
  } catch (err) {
    logger.error({ err }, 'upgrade_request_failed')
    return c.json({ success: false as const, error: (err as Error).message }, 400)
  }
})

// POST /api/settings/upgrade/rollback — go back to last-good (or an explicit version)
upgrade.openapi(createRoute({
  method: 'post',
  path: '/rollback',
  tags: ['Settings'],
  operationId: 'postSettingsUpgradeRollback',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ version: versionSchema.optional() }) } } } },
  responses: {
    200: successResponse(z.object({ requested: z.string() }), 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), (c) => {
  const { version } = c.req.valid('json')
  try {
    const target = requestRollback(version)
    return c.json({ success: true as const, data: { requested: target } }, 200)
  } catch (err) {
    logger.error({ err }, 'upgrade_rollback_failed')
    return c.json({ success: false as const, error: (err as Error).message }, 400)
  }
})

// POST /api/settings/upgrade/restart — relaunch the current version
upgrade.openapi(createRoute({
  method: 'post',
  path: '/restart',
  tags: ['Settings'],
  operationId: 'postSettingsUpgradeRestart',
  responses: {
    200: successResponse(z.object({ status: z.literal('restarting') }), 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), (c) => {
  try {
    requestRestart()
    return c.json({ success: true as const, data: { status: 'restarting' } }, 200)
  } catch (err) {
    logger.error({ err }, 'upgrade_restart_failed')
    return c.json({ success: false as const, error: (err as Error).message }, 400)
  }
})

export default upgrade

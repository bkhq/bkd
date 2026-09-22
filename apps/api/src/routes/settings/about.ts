import { SystemInfoSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
import { arch, platform } from 'node:os'
import { getServerName, getServerUrl } from '@/db/helpers'
import { createOpenAPIRouter } from '@/openapi/hono'
import { getVersionInfo } from '@/upgrade/service'

const about = createOpenAPIRouter()

const startedAt = Date.now()

// GET /api/settings/system-info
about.openapi(createRoute({
  method: 'get',
  path: '/system-info',
  tags: ['Settings'],
  operationId: 'getSettingsAboutSystemInfo',
  responses: {
    200: successResponse(SystemInfoSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const versionInfo = getVersionInfo()
  const [serverName, serverUrl] = await Promise.all([getServerName(), getServerUrl()])

  return c.json({
    success: true as const,
    data: {
      app: {
        version: versionInfo.version,
        commit: versionInfo.commit,
        supervised: versionInfo.supervised,
        activeVersion: versionInfo.activeVersion,
        startedAt: new Date(startedAt).toISOString(),
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      },
      runtime: {
        bun: Bun.version,
        platform: platform(),
        arch: arch(),
        nodeVersion: process.version,
      },
      server: {
        name: serverName,
        url: serverUrl,
      },
      process: {
        pid: process.pid,
      },
    },
  }, 200)
})

export default about

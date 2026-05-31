import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { authMiddleware, authRoutes } from './auth'
import { getEngineDiscovery } from './engines/startup-probe'
import { httpLogger, logger } from './logger'
import { apiRoutes, engineRoutes, eventRoutes, settingsRoutes } from './routes'
import cronRoute from './routes/cron'
import notesRoutes from './routes/notes'
import terminalRoute from './routes/terminal'
import workspaceRoutes from './routes/workspaces'
import { VERSION } from './version'

export interface AppDeps {}

export function createApp(_deps?: AppDeps): OpenAPIHono {
  const app = new OpenAPIHono()

  // --- Security headers (CSP + HSTS) ---
  app.use(secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ['\'self\''],
      scriptSrc: ['\'self\'', '\'unsafe-inline\''],
      styleSrc: ['\'self\'', '\'unsafe-inline\''],
      imgSrc: ['\'self\'', 'data:', 'blob:'],
      connectSrc: ['\'self\''],
      fontSrc: ['\'self\''],
      frameAncestors: ['\'none\''],
      baseUri: ['\'self\''],
      formAction: ['\'self\''],
      objectSrc: ['\'none\''],
    },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }))

  // --- CORS ---
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? '*'
  app.use('/api/*', cors({
    origin: allowedOrigin === '*'
      ? '*'
      : allowedOrigin.split(',').map(o => o.trim()),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: allowedOrigin !== '*',
  }))

  // --- Compression (skip for SSE routes) ---
  app.use('*', async (c, next) => {
    if (c.req.path.endsWith('/stream') || c.req.path === '/api/events') {
      return next()
    }
    return compress()(c, next)
  })

  // --- HTTP request logging ---
  app.use(httpLogger())

  // --- Auth routes (public, must be before auth middleware) ---
  app.route('/api/auth', authRoutes)

  // --- API docs (public, before auth middleware) ---
  app.get('/api/docs', swaggerUI({ url: '/api/docs/openapi.json' }))
  app.doc31('/api/docs/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'BKD API',
      description: 'Kanban board for managing AI coding agents.',
      version: VERSION,
      license: { name: 'MIT' },
    },
    servers: [{ url: '/', description: 'Default' }],
    tags: [
      { name: 'Meta', description: 'Health, status, and runtime information' },
      { name: 'Projects', description: 'Project CRUD and lifecycle' },
      { name: 'Issues', description: 'Issue CRUD, bulk updates, and duplication' },
      { name: 'Issue Commands', description: 'Execute, follow-up, restart, cancel AI sessions' },
      { name: 'Issue Logs', description: 'Retrieve and filter issue conversation logs' },
      { name: 'Engines', description: 'AI engine discovery, settings, and models' },
      { name: 'Cron', description: 'Scheduled job management' },
      { name: 'Events', description: 'Server-Sent Events for real-time updates' },
      { name: 'Processes', description: 'Active engine process management' },
      { name: 'Worktrees', description: 'Git worktree management per project' },
      { name: 'Notes', description: 'Scratch notes' },
      { name: 'Whiteboard', description: 'Project mindmap whiteboard' },
      { name: 'Settings', description: 'Application settings and configuration' },
      { name: 'Webhooks', description: 'Webhook notification management' },
      { name: 'Workspaces', description: 'Workspace management and project grouping' },
    ],
  })
  app.get('/api/openapi.json', c => c.redirect('/api/docs/openapi.json'))

  // --- Auth middleware ---
  app.use('/api/*', authMiddleware())

  // --- Routes ---
  app.route('/api', apiRoutes)
  app.route('/api/engines', engineRoutes)
  app.route('/api/events', eventRoutes)
  app.route('/api/settings', settingsRoutes)
  app.route('/api/notes', notesRoutes)
  app.route('/api/cron', cronRoute)
  app.route('/api/workspaces', workspaceRoutes)
  app.route('/api', terminalRoute)

  // --- 404 handler ---
  app.all('/api/*', (c) => c.json({ success: false, error: 'Not Found' }, 404))

  // --- Global error handler ---
  app.onError((err, c) => {
    logger.error(
      { message: err.message, stack: err.stack, path: c.req.path, method: c.req.method },
      'unhandled_error',
    )
    if (err instanceof SyntaxError) {
      const msg = err.message
      if (msg.startsWith('JSON Parse error') || /^Unexpected (token|end of JSON)/.test(msg)) {
        return c.json({ success: false, error: 'Invalid JSON' }, 400)
      }
    }
    return c.json({ success: false, error: 'Internal server error' }, 500)
  })

  // Warm up engine discovery
  void getEngineDiscovery().catch(err => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'probe_failed',
    )
  })

  return app
}

export const app = createApp()
export default app

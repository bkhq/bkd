import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import swaggerScript from 'swagger-ui-dist/swagger-ui-bundle.js' with { type: 'text' }
import swaggerStyles from 'swagger-ui-dist/swagger-ui.css' with { type: 'text' }
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { getEngineDiscovery } from './engines/startup-probe'
import { httpLogger, logger } from './logger'
import { apiRoutes, engineRoutes, eventRoutes, settingsRoutes } from './routes'
import cronRoute from './routes/cron'
import sessionsRoute from './routes/sessions'
import notesRoutes from './routes/notes'
import terminalRoute from './routes/terminal'
import { VERSION } from './version'
import { runtimeConfig } from './runtime-config'

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
const allowedOrigin = runtimeConfig.ALLOWED_ORIGIN
app.use('/api/*', cors({
  origin: allowedOrigin === '*'
    ? '*'
    : allowedOrigin.split(',').map(o => o.trim()),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  exposeHeaders: ['Content-Length', 'X-Request-ID'],
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

// Reject unsupported request formats before validators can ignore the body.
app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method) && c.req.raw.body !== null) {
    const mediaType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()
    const acceptsMultipart = /^\/api\/projects\/[^/]+\/issues(?:\/[^/]+\/follow-up)?\/?$/.test(c.req.path)
      || /^\/api\/files\/[^/]+\/upload(?:\/|$)/.test(c.req.path)
    if (mediaType !== 'application/json' && !(acceptsMultipart && mediaType === 'multipart/form-data')) {
      return c.json({ success: false, error: 'Unsupported media type' }, 415)
    }
  }
  await next()
})

// --- API docs ---
app.get('/api/docs/assets/swagger-ui-dist/swagger-ui-bundle.js', c =>
  c.body(swaggerScript, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }))
app.get('/api/docs/assets/swagger-ui-dist/swagger-ui.css', c =>
  c.body(swaggerStyles, 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }))
app.get('/api/docs', swaggerUI({ url: '/api/docs/openapi.json', baseUrl: '/api/docs/assets' }))
app.doc31('/api/docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'BKD API',
    description: 'Kanban board for managing AI coding agents. Issues are assigned to CLI-based AI engines (Claude Code, Codex) that execute autonomously.',
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
    { name: 'Settings', description: 'Application settings and configuration' },
    { name: 'Webhooks', description: 'Webhook notification management' },
  ],
})
app.get('/api/openapi.json', c => c.redirect('/api/docs/openapi.json'))

// --- Routes ---
app.route('/api', apiRoutes)
app.route('/api/engines', engineRoutes)
app.route('/api/events', eventRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/notes', notesRoutes)
app.route('/api/cron', cronRoute)
app.route('/api/sessions', sessionsRoute)
app.route('/api', terminalRoute)

// --- 404 handler ---
app.all('/api/*', (c) => {
  return c.json({ success: false, error: 'Not Found' }, 404)
})

// --- API-002: Global error handler ---
app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) {
    return c.json({ success: false, error: err.message }, err.status)
  }
  // Log the error
  logger.error(
    {
      message: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
      requestId: c.res.headers.get('X-Request-ID'),
    },
    'unhandled_error',
  )

  // All other errors
  return c.json({ success: false, error: 'Internal server error' }, 500)
})

// Warm up engine discovery on startup (cache → DB → live probe)
void getEngineDiscovery().catch((err) => {
  logger.error(
    {
      error: err instanceof Error ? err.message : String(err),
    },
    'probe_failed',
  )
})

export default app

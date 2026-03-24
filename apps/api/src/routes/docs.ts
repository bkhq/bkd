import { Hono } from 'hono'
import { swaggerUI } from '@hono/swagger-ui'
import { getOpenAPISpec } from '@/openapi/registry'

const docs = new Hono()

// GET /api/docs — Swagger UI
docs.get('/', swaggerUI({ url: '/api/openapi.json' }))

// GET /api/openapi.json — auto-generated OpenAPI 3.1 spec from Zod schemas
docs.get('/openapi.json', c => c.json(getOpenAPISpec()))

export default docs

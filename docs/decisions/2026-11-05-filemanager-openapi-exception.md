# /api/fm stays out of the BKD OpenAPI document

- **date**: 2026-11-05
- **sunset**: 2027-05-05

BKD routes use `@hono/zod-openapi`. The vendored filemanager router describes its routes
with `hono-openapi` and its own zod schemas (`src/fm/core/schema.ts`), validated on every
request. `/api/fm/*` is mounted as a plain Hono sub-app and is not part of
`/api/docs/openapi.json`; its contract is upstream's `docs/architecture.md` §3.4.

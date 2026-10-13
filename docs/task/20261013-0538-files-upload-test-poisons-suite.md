# 20261013-0538-files-upload-test-poisons-suite Stop api-files-upload.test.ts from breaking every later API test

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-10-13 05:38

## Description

`test/api-files-upload.test.ts` imports `@/routes/files` before `@/app`, so `openapi/schemas.ts` evaluates before `@hono/zod-openapi` extends zod and throws `.openapi is not a function`. Bun caches the failed module, and every later test file that loads the app fails at import: `bun run test:api` reports 510 pass / 30 fail and skips the tests of those files (541 run vs 771).

Acceptance: `bun run test:api` no longer reports the `.openapi is not a function` error, and the full test count runs.

## ActiveForm

Fixing the files-upload test import order.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Found while verifying `20261013-0244-worktree-cleanup-on-delete`.

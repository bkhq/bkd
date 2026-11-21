# 20261121-1141-virtual-engine-oauth-models List Anthropic models for OAuth-token virtual engines

- Status: done
- Priority: P2

## Problem

A `claude-code` virtual engine authenticated with `CLAUDE_CODE_OAUTH_TOKEN` (no `baseUrl`) gets an empty model
list from `fetchVirtualEngineModels()`, so the selector shows only the manual `model`. Its auth status also ignores
the token and mirrors the local CLI login.

## Scope

- `apps/api/src/engines/virtual-engines.ts`: with no base URL, a `claude-code` virtual engine carrying
  `CLAUDE_CODE_OAUTH_TOKEN` lists models from `https://api.anthropic.com/v1/models?limit=1000` with
  `Authorization: Bearer`, `anthropic-version` and `anthropic-beta: oauth-2025-04-20`; `display_name` becomes the
  model name. Third-party base URLs keep their current request (plus `anthropic-version`).
- `CLAUDE_CODE_OAUTH_TOKEN` counts as the virtual engine's own credentials for `authStatus`.
- Out of scope: Anthropic API keys (`ANTHROPIC_API_KEY` is a protected env key).

## Verification

- Tests in `apps/api/test/api-virtual-engines.test.ts` for the OAuth URL/headers, `display_name`, and auth status.
- `bun run check`.

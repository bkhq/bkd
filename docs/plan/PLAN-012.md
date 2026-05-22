# PLAN-012 Virtual engines (claude-code executor + preset env vars)

- **status**: completed
- **createdAt**: 2026-05-22
- **task**: ENG-013

## Goal

Let users define **virtual engines** that reuse the real `claude-code`
executor but inject a preset set of environment variables (typically
`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`) so the
Claude Code CLI routes to a third-party Anthropic-compatible backend. A
virtual engine is selectable like any engine; at runtime it still spawns
`claude-code`, only with the extra env merged in.

## Approved decisions

1. **Persistence**: new nullable column `issues.engine_profile_id` (Drizzle
   `db:generate` migration). `engine_type` stays `claude-code` for virtual
   engines, so protocol/normalizer/registry are untouched.
2. **Protected keys**: profile envVars flow through the existing
   project/global env channel, so `safe-env.ts` `PROTECTED_KEYS` still
   applies (cannot set `ANTHROPIC_API_KEY`). Third-party relays use
   `ANTHROPIC_AUTH_TOKEN`, which is allowed. Out of scope to bypass.
3. **Merge priority**: profile envVars override project envVars.
4. **Model**: a virtual engine carries its own optional `model`; not reusing
   the hardcoded `CLAUDE_MODELS`.

## Data model

App setting `engine:virtualEngines` → JSON array of:

```ts
interface VirtualEngine {
  id: string            // selectable engine id, e.g. "glm-4-6"
  name: string          // display name
  baseEngine: EngineType // 'claude-code' (only supported base in v1)
  model?: string        // passed as --model / shown in model dropdown
  envVars: Record<string, string>
}
```

## Backend changes

- `packages/shared/src/index.ts`: add `VirtualEngine`; add
  `engineProfileId: string | null` to `Issue`.
- `apps/api/src/db/schema.ts`: add `engineProfileId` to `issues`; run
  `bun run db:generate` (commit schema + .sql + snapshot + journal).
- `apps/api/src/engines/virtual-engines.ts` (new): `getVirtualEngines`,
  `getVirtualEngine(id)`, `setVirtualEngines(list)`, validation, and
  `resolveProfileEnvVars(engineProfileId)`.
- `apps/api/src/engines/issue/utils/helpers.ts`: `resolveExecEnvVars(issueRow,
  projectEnvVars)` → `{ ...projectEnvVars, ...profileEnv }`.
- Merge at the four spawn paths: `orchestration/execute.ts`,
  `orchestration/restart.ts`, `lifecycle/spawn.ts` (`spawnRetry`,
  `spawnFollowUpProcess`).
- `engine-store.ts`: add `engineProfileId` to `IssueSessionFields`.
- `routes/issues/create.ts`: widen `engineType` validation to a string
  pattern; resolve virtual id → `engineType=baseEngine`,
  `engineProfileId=virtualId`, `model = body.model ?? profile.model`; persist
  `engineProfileId`. Keep existing precedence for real engines.
- `routes/issues/_shared.ts`: `serializeIssue` exposes `engineProfileId`;
  widen `executeIssueSchema.engineType`.
- `routes/engines.ts` + `engines/startup-probe.ts`: decorate
  `getEngineDiscovery()` so virtual engines appear in `engines` (installed /
  executable mirrored from base) and `models[virtualId]`; include virtual
  engines in `/api/engines/profiles`. Add CRUD:
  `GET/POST/PATCH/DELETE /api/engines/virtual`.

## Frontend changes

- `lib/kanban-api.ts` + `hooks/use-kanban.ts`: virtual-engine list + CRUD
  hooks; query keys.
- `CreateIssueDialog`: works via discovery+profiles (virtual engines appear
  automatically); verify only.
- Existing issues: pass `issue.engineProfileId ?? issue.engineType` to
  display components (ChatInput etc.) so name/models resolve to the virtual
  engine.
- `AppSettingsDialog`: management section to CRUD virtual engines.
- `EngineIcons`: already has unknown-engine fallback; verify.
- i18n: `en.json` + `zh.json`.

## Risks

- Migration discipline: must use `db:generate`; CI `Migrations` job checks.
- `authStatus` for a virtual engine: mirror base engine; do not show
  spurious "unauthenticated".
- Scope creep: v1 supports only `baseEngine='claude-code'`.

## Verification

- `bun run db:generate` yields a single new migration; no uncommitted diff.
- API tests: virtual-engine CRUD; create-with-virtual persists
  `engineProfileId` + `engineType=claude-code`; env merge precedence.
- `bun run lint`, `bun run test`, `bun run typecheck` green.
- Manual: define a virtual engine, create an issue with it, confirm spawn
  command env carries the preset vars (LOG_LEVEL=debug spawn log).

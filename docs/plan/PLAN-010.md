# PLAN-010 Per-project default engine and model

- **status**: completed
- **createdAt**: 2026-05-15
- **approvedAt**: 2026-05-15
- **relatedTask**: ENG-008

## Context

Default engine/model is global-only. Projects already override
`systemPrompt` / `envVars`, so add two nullable columns to `projects`
(`default_engine`, `default_model`); `NULL` = inherit global. Insert a
project tier into the issue-create resolution chain.

## Proposal

### Step 1 — DB + shared types

- `db/schema.ts`: `defaultEngine: text('default_engine')`,
  `defaultModel: text('default_model')` on `projects`.
- `bun run db:generate` -> migration `0020`.
- `packages/shared/src/index.ts`: `Project` + optional `defaultEngine`,
  `defaultModel`.

**Exit**: typecheck clean; migration file present and additive.

### Step 2 — API

- `openapi/schemas.ts`: add to `ProjectSchema` (output),
  `CreateProjectSchema` / `UpdateProjectSchema` (input). Engine:
  `z.enum(['claude-code', 'codex']).nullable().optional()`. Model:
  `z.string().max(200).nullable().optional()`.
- `routes/projects.ts`: `serializeProject` emits both; create/update
  persist them (empty string -> NULL).
- `routes/issues/create.ts`: resolution chain
  `body ?? project ?? global ?? 'claude-code'` for engine (then registry
  coercion) and `body ?? project ?? global engine default` for model
  (ignore `auto`).

**Exit**: precedence unit/integration tests green.

### Step 3 — Frontend

- `ProjectSettingsDialog.tsx`: new "Engine & Model" section. Engine
  dropdown with an explicit "Inherit global" entry (value = empty);
  model input/select gated on chosen engine. Reuse
  `useEngineAvailability` / `useEngineProfiles` / `useEngineSettings`
  and `EngineIcon`. Wire through existing `useUpdateProject`.
- i18n keys in `en.json` + `zh.json`.

**Exit**: frontend lint + typecheck + tests green; manual smoke optional.

### Step 4 — Docs + record

- `CLAUDE.md` data-layer note; `docs/api/*` project field tables.
- ENG-008 / PLAN-010 -> completed.

## Risks

1. Resolution precedence regressions — covered by explicit tests for all
   four tiers plus stale-engine coercion.
2. Empty vs null semantics — normalize empty string to NULL on write;
   UI provides an explicit inherit option.
3. Stale persisted project engine after a future engine removal —
   mitigated by the existing issue-create registry coercion.

## Verification Plan

- `bun run lint` / `bunx tsc --noEmit` (api + frontend) clean.
- `bun run test:api` / `bun run test:frontend` green, including new
  precedence + serialization cases.

## Out of Scope

- Shared selector component extraction.
- Create-project-time default selection.

# 20261110-1254-same-base-engine-switch-effort Switch between engines sharing a base engine, and pass effort

- **status**: completed
- **createdAt**: 2026-11-10 12:54
- **approvedAt**: 2026-11-10 12:59
- **relatedTask**: 20261110-1254-same-base-engine-switch-effort

## Context

- An issue stores its base engine in `issues.engineType` and an optional virtual engine id in
  `issues.engineProfileId`. Only `POST /execute` sets them (`routes/issues/command.ts`). `FollowUpSchema` and
  `UpdateIssueSchema` carry `model` but no engine, so once executed an issue is locked to its engine/profile.
- Every spawn re-reads the profile: `resolveExecEnvVars(issue.engineProfileId, ...)` in `lifecycle/spawn.ts`
  (fresh, retry, follow-up) and `orchestration/restart.ts`. Changing `engineProfileId` on the row is therefore enough
  for the next spawn to use the new env, and the session (`externalSessionId`) is kept because the CLI is the same.
- `resolveExecutionModel()` passes the model through when `engineProfileId` is set, else validates against the
  base engine's list.
- `orchestration/follow-up.ts` reuses an idle live process (`sendInputToRunningProcess`) whatever model was sent;
  a model change is only checked at the route (409 while running/pending). Env, model and effort are fixed at spawn,
  so reusing a live process after any of them changed silently keeps the old values.
- Effort: Claude CLI 2.1.322 has `--effort <low|medium|high|xhigh|max>` and the env `CLAUDE_CODE_EFFORT_LEVEL`; the
  env var takes precedence over the flag. BKD has no effort concept today; the claude executor builds args in
  `createBaseBuilder()` (`executors/claude/executor.ts`).
- Frontend `ChatInput` lists only `discovery.models[engineType]` where `engineType = engineProfileId ?? engineType`;
  outside `working` a model pick is PATCHed right away, during `working` it rides on the next follow-up.

## Proposal

Backend
1. Shared types: `ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'` (+ `CLAUDE_EFFORTS`), `Issue.effort:
   ClaudeEffort | null`.
2. DB: nullable `issues.effort` text column; migration via `bun run db:generate`.
3. Schemas: `effort` (enum, nullable in PATCH to clear) on `ExecuteIssueSchema`, `FollowUpSchema` (also in the
   multipart key list), `UpdateIssueSchema`; `engineType` (same regex as execute) on `FollowUpSchema` and
   `UpdateIssueSchema`.
4. New helper `resolveEngineSwitch(issue, targetId)` in `engines/virtual-engines.ts`: resolves the target's base
   engine (real id or virtual id); returns `{ engineProfileId }` when the base equals `issue.engineType`, an error
   otherwise. Used by follow-up route and PATCH. Changing engine or effort while running/pending -> 409 (same rule as
   model); during `working` PATCH rejects it like model.
5. Follow-up route persists `engineProfileId` / `effort` on the issue before dispatch, so queued/pending flushes and
   retries use them too. Execute persists `effort` with the rest.
6. `SpawnOptions.effort?`; the spawn paths read `issue.effort` and pass it. Claude executor: when set, put
   `CLAUDE_CODE_EFFORT_LEVEL=<effort>` into the process env (wins over a profile's value and the flag). Codex, grok,
   cursor ignore it.
7. `follow-up.ts`: do not reuse an idle live process after the engine profile, model or effort changed. The
   follow-up route and PATCH set `settingsChanged` on the live process; the next follow-up terminates it
   (SIGTERM inside `pm.terminate`) and spawns a new follow-up process. A process mid-turn keeps queueing as before.

Frontend
8. `kanban-api.ts` / `use-kanban.ts`: `engineType` + `effort` on follow-up and update payloads.
9. `ChatInput`: the model menu groups models by engine for every engine with the same base engine (base + its
   virtual engines, from `discovery` + `profiles`); a pick sets engine + model. An effort menu (Default + 5 levels)
   shows for claude-code-based engines. Same save rule as model today: PATCH outside `working`, sent with the
   follow-up during `working`.
10. i18n keys in `en.json` / `zh.json`.

Tests (RED first)
- API: follow-up/PATCH switch to a same-base virtual engine updates `engineProfileId` and the spawn gets its env;
  cross-base -> 400; while running -> 409; effort persisted and present in the claude spawn env; changed settings
  skip live-process reuse.
- Claude executor: effort -> `CLAUDE_CODE_EFFORT_LEVEL` in env, overriding profile env.
- Frontend: ChatInput lists same-base engines' models and sends engine/effort.

## Risks

- Session compatibility: a virtual engine with its own `baseUrl` points the CLI at another provider. Resuming a
  session there works with the local transcript, but provider-specific content (e.g. thinking signatures) may be
  rejected by a different backend. Accepted: the user chose same-base switching; the fallback to a fresh session in
  `spawnWithSessionFallback` covers a missing session only, not a rejected one.
- Effort on a model without effort support: the CLI downgrades or ignores it (its own model-support logic).
- Migration: additive nullable column, no backfill.
- Public API: additive optional fields only.

## Scope

About 15 files: shared types, db schema + migration, openapi schemas, routes (`message.ts`, `update.ts`,
`command.ts`), `virtual-engines.ts`, `follow-up.ts`, `spawn.ts`, `restart.ts`, engine types, claude executor,
frontend `ChatInput`, api client/hooks, i18n, plus tests.

## Alternatives

- Effort as `--effort` flag: loses to a virtual engine's `CLAUDE_CODE_EFFORT_LEVEL`, so the env var is used.
- Effort per turn without persisting: retries, restarts and pending flushes would drop it; rejected.
- Codex effort (`model_reasoning_effort` / `turn/start` `effort`): left for a separate task.

## Annotations

(none)

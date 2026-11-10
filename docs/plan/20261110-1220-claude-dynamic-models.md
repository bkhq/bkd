# 20261110-1220-claude-dynamic-models Fetch the claude-code model list from the CLI

- **status**: completed
- **createdAt**: 2026-11-10 12:20
- **approvedAt**: 2026-11-10 12:24
- **relatedTask**: 20261110-1220-claude-dynamic-models

## Context

- `executors/claude/executor.ts` hardcodes `CLAUDE_MODELS` (Fable/Opus/Sonnet plus `[1m]` variants, default
  `claude-sonnet-5-5`); `getModels()` returns it. Every new model needs a code change and a release.
- `startup-probe.ts` treats that list as authoritative: `withFreshStaticModels()` overlays it on cached/DB data,
  and `getEngineModels('claude-code')` bypasses the cache. `model-resolver.ts` keeps a pinned model only when it is
  in the list, else falls back to the default; an empty list passes the request through.
- The CLI has no `models` subcommand, but `claude -p --input-format stream-json --output-format stream-json
  --verbose` answers an `initialize` control request (no user message, no tokens) with
  `response.response.models[]`: `{ value, resolvedModel, displayName, description, supportedEffortLevels, ... }`.
  Verified on 2.1.322: `default` (-> `claude-opus-5-5`), aliases `opus`/`fable`/`sonnet`/`haiku`, then full IDs
  (`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-4-6`, ...). No `[1m]` variants and no 1M-support flag.
- The live probe runs only on demand (first install, vanished binary, the Settings "probe engines" button,
  ENG-035), so an extra CLI spawn there is acceptable.

## Proposal

1. `ClaudeCodeExecutor.getModels()` spawns the CLI as above, writes one `initialize` control request, reads stdout
   until the matching `control_response`, kills the process (10 s timeout, inside the probe's 15 s per-engine cap).
2. Map with a pure, exported `mapInitModels(raw)`:
   - `id = resolvedModel`, deduplicated (the `default` and `opus` entries both resolve to `claude-opus-5-5`), so
     stored issue models keep using full IDs.
   - `name = displayName`, `description = description`.
   - `isDefault` on the model the CLI's `default` entry resolves to.
   - `[1m]` variants: see Annotations (open decision).
3. Delete `CLAUDE_MODELS`, `withFreshStaticModels()`, and the `getEngineModels('claude-code')` cache bypass; claude
   models are cached in memory + DB like codex's.
4. Failure (not installed, not logged in, timeout, malformed output) returns `[]`; the resolver already passes the
   requested model through on an empty list.
5. Tests: `mapInitModels` unit tests (dedupe, default, missing fields); update `model-resolver.test.ts` to seed the
   cache instead of relying on the static list, and drop the "static catalog wins" case.
6. Docs: CLAUDE.md startup-probe bullet, changelog.

## Risks

- The default changes from the hardcoded `claude-sonnet-5-5` to the CLI's account default (`claude-opus-5-5` on
  this host). Issues on `auto` will run on that model.
- Issues pinned to a model the CLI no longer lists fall back to the default (same rule as today).
- The `initialize` response shape is not a documented contract; a CLI change could empty the list. Mitigated by
  pass-through on an empty list and a warn log.
- Cached data refreshes only on a re-probe; after a CLI update the list stays stale until the user probes.
- The uncommitted Fable 5.2 catalog edit in the working tree becomes moot; its changelog entry stays as history.

## Scope

`executors/claude/executor.ts`, `engines/startup-probe.ts`, `test/model-resolver.test.ts`, a new
`test/claude-models.test.ts`, `CLAUDE.md`, `docs/changelog.md`. No schema, route, or frontend change.

## Alternatives

- Reuse the existing slash-command discovery process (`-- /`, `--max-turns 1`) to also read models: it does not
  emit the model list in `system/init`; `initialize` is needed anyway.
- Use alias `value`s (`opus`, `sonnet`) as IDs so selection tracks new releases automatically: breaks every stored
  full-ID selection and the resolver check. Rejected.

## Annotations

Decision (2026-11-10): option A — `[1m]` variants (the CLI does not list them):
- A (recommended): for each listed Opus/Sonnet/Fable model add `<id>[1m]` "(1M)"; Haiku gets none.
- B: no `[1m]` entries; issues pinned to `[1m]` fall back to the default.

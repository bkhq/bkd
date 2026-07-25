# PLAN-013 Upgrade all workspace dependencies to latest

- **status**: completed
- **createdAt**: 2026-07-17
- **task**: DEV-002

## Context (investigation findings)

`bun outdated --filter '*'` on 2026-07-17 reports 40 outdated entries across
`@bkd/root`, `@bkd/api`, `@bkd/frontend`, and the root catalog. Registry and
changelog verification results:

- **nanoid 6.0.0**: 4x faster `nanoid()`/`customAlphabet()`; drops Node
  18/20. We only use `customAlphabet` (schema.ts, routes/projects.ts) on Bun
  — no code change needed.
- **@atlaskit/pragmatic-drag-and-drop(-hitbox) 2.x**: sole major change is
  removal of legacy TypeScript 4 `typesVersions` shims; runtime API
  untouched. 4 frontend files import it — no code change expected.
- **@hono/zod-validator 0.9.0**: switches to `InferInput` from
  `hono/validator`; requires `hono >= 4.11.2` (we bump hono to 4.12.30 in the
  same pass).
- **@antfu/eslint-config 9.x**: breaking change is the jump to
  @eslint-react/eslint-plugin 5.0 — we bump both together; dev-only. New/renamed
  rules may require `lint:fix` or small config tweaks in `eslint.config.js`.
- **typescript 7.0.2** (`latest` dist-tag): first stable of the native
  compiler line. Risk: `tsc -b` frontend build, typescript-eslint, editor/CI
  parity. Strategy: attempt on a branch step, run full verification; on any
  toolchain failure, keep catalog at `^6.0.3` with a `PINNED` note and record
  it here.
- All remaining entries are minor/patch and within-semver risk.

## Steps

1. Bump minor/patch ranges in all `package.json` files + `bun install`
   -> verify: `bun run lint && bun run test && bun run build`
2. Bump low-risk majors (nanoid, pragmatic-dnd + hitbox, @hono/zod-validator,
   @antfu/eslint-config + @eslint-react/eslint-plugin)
   -> verify: same suite; run `lint:fix` for new lint rules if needed
3. Attempt typescript 7.0.2 in catalog
   -> verify: same suite; on failure revert to `^6.0.3` and record PINNED reason
4. Update CLAUDE.md only if a bump changes documented behavior; changelog entry.

## Result (2026-07-17)

- Steps 1–2 landed: all minor/patch bumps plus majors nanoid 6, pragmatic-dnd
  2.x, @hono/zod-validator 0.9, @antfu/eslint-config 9 + @eslint-react 5.
- eslint-react 5 merged its rule namespaces into `react/*`; three stale
  disables in `eslint.config.js` were renamed accordingly and
  `react/static-components` was turned off (false positive on stable
  component lookups, e.g. `getToolIcon` returning lucide refs).
- **typescript PINNED at `^6.0.3`**: 7.0.2 builds fine (`tsc -b` passes) but
  @typescript-eslint/typescript-estree 8.64.0 (shipped by @antfu/eslint-config
  9.1.0) crashes on load (`TypeError: Cannot read properties of undefined
  (reading 'Cjs')` in `create-program/shared.js`). Revisit when
  typescript-eslint supports the TS7 native compiler.
- Verification: `lint` 0 errors (4 warnings, down from 7 pre-upgrade);
  frontend 40/40 pass; build passes; api 548 pass / 1 fail — the failure is a
  pre-existing order-dependent test-pollution bug, reproduced on the
  pre-upgrade baseline: `security-filesystem-symlink.test.ts` afterAll
  restores `workspace:defaultPath` to `''` instead of deleting the key, and
  `GET /api/settings/workspace-path` uses `value ?? homedir()`, which `''`
  bypasses. Not touched here (out of scope); candidate follow-up task.

## Out of scope

- No source refactors beyond what compiler/lint upgrades force.
- No Bun runtime upgrade.
- Launcher/package compile pipeline re-test (`bun run compile`) unless a bump
  touches it.

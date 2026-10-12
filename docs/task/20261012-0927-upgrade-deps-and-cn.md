# 20261012-0927-upgrade-deps-and-cn Upgrade all dependencies and replace clsx + tailwind-merge with cn

- **status**: completed
- **priority**: P2
- **owner**: cd
- **createdAt**: 2026-10-12 09:27

## Description

`bun outdated --filter '*'` on 2026-10-12 reports 40 outdated packages. Two
cross a major boundary; the rest are minor or patch. Separately, shadcn now
ships `cn` (github.com/shadcn-ui/cn), a zero-dependency replacement for
`clsx` + `tailwind-merge` with the same API, and the user wants
`src/lib/utils.ts` gone in favour of `import { cn } from 'cn'`.

Findings:

- `@atlaskit/pragmatic-drag-and-drop` 3.1 -> 4.0 and `-hitbox` 2.2 -> 3.0
  only remove the deprecated legacy entry points. The core package is already
  imported through the new `/adapter/*` and `/utils/*` paths. The hitbox
  `/closest-edge` entry was deprecated in 2.2.2; the four imports move to
  `/closest-edge/extract-closest-edge` and `/types`.
- `cn` 0.4.0 exports `cn`, `clsx`, `twMerge` and the `ClassValue` types.
  `class-variance-authority` and `streamdown` still depend on `clsx` /
  `tailwind-merge`; the cn docs recommend a Vite `resolve.alias` so the
  bundle carries one implementation, and note that an incompatible alias
  fails the build loudly.
- Root `typescript` stays on 6.0.3 for typescript-eslint (see CLAUDE.md);
  the catalog is already on 7.0.2.
- React 19.3, Vite 8.3, base-ui 1.9, shiki 4.5, streamdown 2.7, zod 4.6,
  hono 4.13.13, drizzle 0.45.4, eslint 10.12 are minor bumps.

Plan:

1. Add `cn`, drop `clsx` and `tailwind-merge`; delete `src/lib/utils.ts`;
   rewrite the 30 imports; alias both old packages to `cn` in
   `vite.config.ts` and point the `vendor-style` chunk at `cn`;
   set `components.json` `aliases.utils` to `cn`.
2. Bump every outdated package except the root `typescript` pin; fix the
   hitbox imports.
3. Verify: `bun install` clean, lint, typecheck, API and frontend tests,
   build, `db:generate` no diff, `bun run package`, kanban drag smoke test.

## ActiveForm

Upgrading dependencies and migrating to cn.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Requested by the user on 2026-10-12; implemented on `release`, to be
  committed together with 20261012-0919-issue-right-click-menu.
- hitbox 3.0 keeps a `/closest-edge` directory but only as a parent of the
  dedicated entry points; `attachClosestEdge` / `extractClosestEdge` now come
  from `/closest-edge/attach-closest-edge` and `/closest-edge/extract-closest-edge`,
  `Edge` from `/types`.
- `clsx@2.1.1` and `tailwind-merge@3.6.0` remain in `bun.lock` as transitive
  dependencies of class-variance-authority and streamdown; the Vite alias
  keeps them out of the bundle (no `twMerge` / `tailwind-merge` string in any
  emitted chunk; `vendor-style` is 26.5 kB).
- The API suite shows 30 failures before and after the upgrade, all the
  pre-existing `.openapi is not a function` error from main (verified against a
  clean worktree of the same head); no new failures.
- Not verified: kanban drag-and-drop in a browser. `agent-browser` is not
  available in this container. Module resolution is covered by typecheck,
  the Vite build, and a runtime import of the four drag-and-drop entry points.

- complete: lint, typecheck, frontend suite, build, package and migration
  drift checks passed.

## Verification

- `bun install`: clean; `bun outdated` lists only the deliberate root
  `typescript` pin.
- `bun run lint`: 0 errors, 2 pre-existing warnings. `bun run typecheck`:
  both workspaces pass.
- Frontend suite: 27 files, 168 passed. API suite: 507 pass / 30 fail,
  identical to the baseline (see Notes).
- `bun run build`: passes; no clsx / tailwind-merge code in `dist/assets`.
- `bun run db:generate`: no drizzle diff. `bun run package`: 2.2 MB artifact.
- Runtime: `cn('px-2 py-1', false && 'a', { 'text-white': true }, 'px-4')`
  returns `py-1 text-white px-4`; all four pragmatic-drag-and-drop entry
  points resolve to functions.

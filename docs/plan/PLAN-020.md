# PLAN-020 Upgrade all workspace dependencies to latest

- **status**: completed
- **createdAt**: 2026-09-09 02:30
- **approvedAt**: 2026-09-09 03:10
- **relatedTask**: DEV-004

## Context

`bun outdated --filter '*'` on 2026-09-09 (bun 1.4.0) reports 43 outdated
packages across `@bkd/root`, `@bkd/api`, `@bkd/frontend` and the workspace
catalog. The previous sweep was DEV-002 / PLAN-013 on 2026-07-17.

Six of them cross a major boundary; the rest are minor or patch. Findings from
reading the changelogs and probing the tree:

- **typescript 6.0.3 -> 7.0.2 (catalog)**. The v7 npm package ships only the
  native compiler — `node_modules/typescript/lib/` contains `tsc.js`,
  `getExePath.js` and `version.cjs`, and the package `exports` map points `.`
  at `version.cjs` with the compiler surface behind `./unstable/*`. There is no
  classic `ts.*` JS API. `@antfu/eslint-config@9` pulls
  `@typescript-eslint/{parser,eslint-plugin}@^8.62`, and every published
  typescript-eslint release (latest 8.70.0, canary 8.70.1-alpha.0; no v9 exists)
  declares `typescript: ">=4.8.4 <6.1.0"`. A single shared v7 would break
  `bun run lint`.

  Verified by experiment that two versions can coexist in the workspace: set
  the catalog to `^7.0.2` (consumed by `@bkd/api`, `@bkd/frontend`,
  `@bkd/shared`) and give `@bkd/root` its own off-catalog
  `typescript: ^6.0.3`. `bun install` then resolves
  `node_modules/typescript` to 6.0.3 for the root — which is what
  typescript-eslint loads — and `apps/*/node_modules/typescript` plus
  `packages/shared/node_modules/typescript` to 7.0.2. Measured on this tree:
  `bun run lint` reports 0 errors (2 pre-existing `react/purity` and
  `react/use-state` warnings), `bunx tsc --noEmit` inside both `apps/api` and
  `apps/frontend` passes on 7.0.2, `bun run build` passes, and
  `bun run db:generate` produces no drizzle diff.

  One consequence: the CI `Typecheck` job runs
  `bunx tsc --noEmit -p apps/<app>/tsconfig.json` from the repository root,
  where `bunx tsc` resolves to the root's 6.0.3. It would silently keep
  typechecking on v6. The job has to move to per-workspace invocation.

- **@atlaskit/pragmatic-drag-and-drop 2.0.1 -> 3.1.0**. 3.0.0 renamed the
  subpath entry points (`/element/adapter` ->
  `/adapter/{monitor,draggable,drop-target}-...`, `/reorder` ->
  `/utils/reorder`). Legacy paths remain as deprecated compatibility shims, so
  the bump is non-breaking on its own. Four files import from the package:
  `components/kanban/{KanbanColumn,KanbanCard,KanbanBoard}.tsx` and
  `pages/HomePage.tsx`. The sibling `-hitbox` package stays on 2.x, so
  `/closest-edge` imports are unaffected.
- **vitest 4.1.10 -> 5.0.0**. Requires Node 22 and Vite 6.4 — satisfied (Bun
  1.4 reports `process.versions.node` 26.3.0; the frontend is on Vite 8.2).
  Behavioural breaks that can touch this repo: mocks are now cleared before
  each test by default, and the `sequential` test option was removed. Thirteen
  test files live under `apps/frontend/src/__tests__/`; six of them use
  `vi.mock` / `mockReturnValue` / `mockImplementation`.
- **jsdom 29.1.1 -> 30.0.1**. The only breaking change in 30.0.0 is the Node
  minimum (`^22.22.2 || ^24.15.0 || >=26.0.0`). Satisfied under Bun; CI's
  `actions/setup-node@v7` with `node-version: 22` resolves to a 22.x newer
  than 22.22.2, and the test job runs vitest through `bunx` anyway.
- **@testing-library/jest-dom 6.9.1 -> 7.0.1**. `toHaveTextContent` is now
  strict. No test in the repo uses that matcher, so this is a no-op bump.
  Peer `@testing-library/dom >=10 <11` is satisfied via
  `@testing-library/react` 16.3.
- **@libsql/client 0.17.4 -> 0.18.0**. Dev-only; no source file imports it. It
  is present for drizzle-kit's SQLite driver (`apps/api/drizzle.config.ts` uses
  `dialect: 'sqlite'`). Covered by the CI `Migrations` check.

No runtime version is pinned anywhere in the repo (no `engines`, no
`.bun-version`, no `packageManager`); CI uses `bun-version: latest`. Nothing
to change there.

GitHub Actions pins, checked against the releases API on 2026-09-09:

| Action | Pinned | Latest |
|---|---|---|
| `actions/checkout` | v6 | v7.0.1 |
| `actions/cache` | v5 | v6.1.0 |
| `actions/setup-node` | v7 | v7.0.0 |
| `actions/upload-artifact` | v7 | v7.0.1 |
| `actions/download-artifact` | v8 | v8.0.1 |
| `oven-sh/setup-bun` | v2 | v2.2.0 |

Only `checkout` and `cache` are behind. `checkout` v7.0.0 is an ESM/dependency
refresh plus one behavioural change — it blocks checking out a fork PR head for
`pull_request_target` and `workflow_run`. Neither workflow uses those triggers
(`ci.yml`: `pull_request`, `workflow_dispatch`, `workflow_call`;
`release.yml`: tag push and `workflow_dispatch`), so it does not apply.
`cache` v6.0.0 is an ESM migration; v6.1.0 adds read-only cache handling.

Both workflows set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`, added by CI-001
as an escape hatch for actions still bundled for Node 20. Every action listed
above declares `using: node24` at its latest major, so once `checkout` and
`cache` move the flag has nothing left to force.

`release.yml` also pins `LODE_VERSION: v0.1.0`, the lode-cli used to sign the
release asset; lode is now at v0.3.1. Probed v0.3.1 directly: the release still
publishes `lode-linux-x64.tar.gz`, the archive still yields a `lode-cli` entry
(now a symlink to `lode`, which `tar -xz lode lode-cli` handles), `sign` keeps
the `--version` / `--key-env` interface, and its output still carries a
`sig:    <value>` line that the workflow's `awk '/^sig:/{print $2}'` parses.
The vendored `apps/api/src/upgrade/lode-sdk.ts` is already byte-identical to
upstream `sdks/lode.ts` at v0.3.1, so it needs no refresh.

A wider sweep for stale pins outside `package.json` turned up four more:

- **lode v0.1.0 is hardcoded in five user-facing places**, not just
  `LODE_VERSION`: the install snippet in `README.md`, in `README.zh-CN.md`, and
  twice in `docs/deployment.md`, plus the release-notes heredoc in
  `release.yml` that every published release carries. Operators following any
  of them install a supervisor two majors behind the SDK the app vendors.
  `docs/deployment.md` says "Pin the version you install — lode is the trust
  root of the update path", so these stay pinned; they just need to name the
  current version.
- **`docs/bkd.lode.toml` pins Bun 1.4.0** (`[runtime].download` plus
  `version`), duplicated in the `docs/deployment.md` config reference. Current
  Bun release is `bun-v1.4.2`. Every key in that file is still valid against
  lode v0.3.1's `docs/lode.example.toml`, including `[update].github`.
- **`@types/dompurify` is a deprecated stub.** The registry marks 3.2.0 with
  "dompurify provides its own type definitions, so you do not need this
  installed", and the installed `dompurify@3.4.12` does ship
  `dist/purify.cjs.d.ts` and `dist/purify.es.d.mts`. It also pulls a second,
  older `dompurify@3.4.2` into the tree.
- **`bun audit` reports 78 advisories** (25 high, 42 moderate, 11 low) on the
  current tree. Most are transitive and several are fixed by bumps already in
  this plan — `vitest` 5 clears GHSA-82fw-gwwq-j7x9, `dompurify` 3.4.15 clears
  the DOMPurify chain up to GHSA-55q2-fjhq-7xh7. The rest sit under `shadcn`
  and the ESLint plugins and are not fixable from here.

Nothing else version-bearing exists: no Dockerfile, no compose file, no
`.nvmrc` / `.tool-versions` / `packageManager`, and no version pins in
`scripts/`, `.env.example` or `components.json`.

## Proposal

1. **Catalog** (`package.json`): `zod ^4.4.3 -> ^4.5.4`,
   `typescript ^6.0.3 -> ^7.0.2`. Add an off-catalog
   `typescript: ^6.0.3` to the root `devDependencies` so typescript-eslint
   keeps a compiler API to load; record why in DEV-004.
2. **Root devDependencies**: `@antfu/eslint-config ^9.5.1`,
   `@eslint-react/eslint-plugin ^5.19.0`, `eslint ^10.10.0`,
   `eslint-plugin-react-refresh ^0.5.6`.
3. **`@bkd/api`**: `@hono/zod-openapi ^1.6.3`, `@hono/zod-validator ^0.9.1`,
   `hono ^4.13.7`, `nanoid ^6.0.1`; dev `@libsql/client ^0.18.0`,
   `@types/bun ^1.4.2`.
4. **`@bkd/frontend`** dependencies: `@atlaskit/pragmatic-drag-and-drop ^3.1.0`,
   `@atlaskit/pragmatic-drag-and-drop-hitbox ^2.2.0`, `@base-ui/react ^1.8.0`,
   `@codemirror/lang-html ^6.4.12`, `@codemirror/lang-markdown ^6.5.2`,
   `@pierre/diffs ^1.4.1`, `@shikijs/{engine-javascript,langs,themes} ^4.4.3`,
   `shiki ^4.4.3`, `@tanstack/react-query ^5.102.8`,
   `@tanstack/react-query-devtools ^5.102.8`, `@tanstack/react-virtual ^3.14.11`,
   `dompurify ^3.4.15`, `i18next ^26.4.2`, `lucide-react ^1.43.0`,
   `react ^19.2.8`, `react-dom ^19.2.8`, `react-i18next ^17.0.13`,
   `react-router-dom ^7.18.3`, `sonner ^2.0.8`, `zustand ^5.0.15`.
5. **`@bkd/frontend`** devDependencies: `@testing-library/jest-dom ^7.0.1`,
   `@testing-library/react ^16.3.3`, `@types/react ^19.2.18`,
   `@types/react-dom ^19.2.7`, `@vitejs/plugin-react ^6.1.1`, `jsdom ^30.0.1`,
   `shadcn ^4.21.0`, `vite ^8.2.2`, `vitest ^5.0.0`.
6. **Typecheck plumbing for the split TypeScript**: add
   `"typecheck": "tsc --noEmit -p tsconfig.json"` to `@bkd/api` and
   `@bkd/frontend`, plus a root `"typecheck": "bun --filter '*' typecheck"`,
   and point the CI `Typecheck` job at `bun run typecheck`. Without this the
   job silently typechecks on the root's v6.
7. **Code change — pragmatic-drag-and-drop 3 entry points**: migrate the four
   importing files off the deprecated shims onto the new paths. This is the
   only source edit in the plan.
8. **GitHub Actions**: `actions/checkout@v6 -> @v7` (three occurrences) and
   `actions/cache@v5 -> @v6` (three occurrences) across `ci.yml` and
   `release.yml`. The other four actions are already on their latest major.
9. **Drop the Node 24 escape hatch**: remove
   `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` from both workflow `env` blocks
   once step 8 lands — it becomes dead configuration.
10. **`node-version: 22 -> 24`** in the `ci.yml` `Setup Node.js` step.
    Approved by the user. Action pins keep the major-only form
    (`actions/checkout@v7`, not `@v7.0.1`), matching the existing style.
11. **lode v0.1.0 -> v0.3.1 everywhere it is named**: `LODE_VERSION` in
    `release.yml`, the release-notes heredoc in the same file, the install
    snippets in `README.md` and `README.zh-CN.md`, and both occurrences in
    `docs/deployment.md`. Residual unknown on the `LODE_VERSION` line only —
    whether a signature produced by lode-cli 0.3.1 verifies on a v0.1.x-era
    lode still installed in the field. I cannot settle that from here, and the
    signing branch is inert while `LODE_SIGNING_KEY` is unset. The five
    documentation occurrences carry no such risk. Say so and I will leave
    `LODE_VERSION` alone while still fixing the docs.
12. **Bun 1.4.0 -> 1.4.2** in `docs/bkd.lode.toml` (`[runtime].download` and
    `version`) and in the mirrored block in `docs/deployment.md`.
13. **Drop `@types/dompurify`** from `@bkd/frontend` devDependencies. Nothing
    imports it, `dompurify` ships its own declarations, and removing it also
    drops the stale `dompurify@3.4.2` copy it drags in.
14. **Fallout budget**: if vitest 5's clear-mocks default breaks a frontend
   test, fix the test (move stub setup into `beforeEach`) rather than pinning
   `clearMocks: false`. If a bump cannot be made green inside this task, back
   it out to the last working version and record the reason in DEV-004.

## Verification

1. `bun install` — lockfile updates cleanly.
2. `bun run lint` — autofix allowed for new rule output from
   `@antfu/eslint-config` 9.5 / eslint 10.10.
3. `bun run typecheck` — both projects on 7.0.2; confirm with
   `bunx tsc --version` inside each app.
4. `bun run test` — api (`bun:test`) and frontend (vitest 5) suites.
5. `bun run db:generate` — no uncommitted drizzle diff (CI `Migrations` job).
6. `bun run build` — `tsc -b` plus `vite build`.
7. `actionlint` is not installed here; both workflows are re-parsed with
   `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"` and
   `grep`-checked for any remaining stale action pin.
8. `bun audit` — record the residual advisory count against the 78 measured
   before the upgrade. Not expected to reach zero; the remainder lives under
   `shadcn` and the ESLint plugins.
9. Manual smoke: `bun run dev`, open `http://bkd.localhost`, drag a card
   between kanban columns and reorder a project card on the home page, to
   exercise the pragmatic-drag-and-drop 3 entry points.

## Risks

- **Medium** — vitest 5 mock-clearing default may surface as flaky or failing
  frontend tests. Contained: 13 test files, all in one directory.
- **Medium** — `lucide-react` jumps 18 minors; an icon name removed in that
  range would fail the build. Caught by step 3/6.
- **Low** — `@base-ui/react` 1.6 -> 1.8 may shift shadcn primitive props.
  Caught by typecheck; visual drift only shows in the smoke test.
- **Low** — pragmatic-drag-and-drop 3 import migration. Caught by typecheck;
  runtime behaviour covered by the smoke test.
- **Low** — eslint 10.10 + antfu 9.5 may introduce new lint errors that
  autofix cannot resolve, requiring small source edits.
- **Low** — the split TypeScript means the root and the apps compile on
  different majors. Only ESLint runs against the root copy, and it does not
  emit; the mismatch is invisible to build output. It disappears once
  typescript-eslint supports v7, at which point the root pin is deleted.
- **Low** — `actions/cache@v6` changes the cache action's internals; a cache
  miss on the first run is expected and harmless.
- **Unresolved** — the lode-cli signature compatibility question in proposal
  step 11. Decide before implementation. Documentation-only lode bumps are
  unaffected.
- **Low** — `docs/bkd.lode.toml` is fetched live from `main` by operators
  (DOC-002), so the Bun pin change reaches them immediately rather than at the
  next release. That is the intended behaviour of serving it from the repo.
- **Known, out of scope** — `GET /api/settings/workspace-path > returns
  current workspace path` already fails on `main` before any bump. Confirmed
  against the unmodified tree; it is not upgrade fallout and is not fixed
  here.

## Alternatives

- **Minor/patch only, defer all six majors.** Smaller diff, but leaves the
  test stack a major behind and keeps the deprecated drag-and-drop entry
  points, which the next sweep has to pay for anyway.
- **Keep typescript on v6 everywhere.** One version, no split, no CI edit —
  but it forgoes the native compiler the user asked for. Rejected.
- **Adopt typescript 7 everywhere, including the root.** Simplest layout, but
  typescript-eslint cannot load the v7 package, so `bun run lint` stops
  working. Rejected.
- **Split into two tasks (runtime deps / dev toolchain).** Two verification
  cycles for one lockfile; no real isolation benefit since both land in the
  same `bun install`.

## Outcome

Completed 2026-09-09. All 14 proposal steps landed as written, plus one
unplanned source change: `src/test-setup.ts` imports
`@testing-library/jest-dom/vitest` instead of the bare package, because v7's
default entry only augments Jest types. See DEV-004 notes.

Verification results:

| Step | Result |
|---|---|
| `bun install` | clean, lockfile updated |
| `bun run lint` | 0 errors, 2 pre-existing warnings |
| `bun run typecheck` | both workspaces pass on TypeScript 7.0.2 |
| `bun run test:api` | 636 pass / 1 skip / 1 fail (the pre-existing failure) |
| frontend `vitest run` | 13 files, 96 tests, all pass on vitest 5.0.0 |
| `bun run db:generate` | no drizzle diff |
| `bun run build` | passes |
| workflow YAML parse | both files parse; no stale action pin remains |
| `bun audit` | 78 -> 58 advisories |
| dev smoke | server up; Vite resolves the v3 drag-and-drop entry points and the prebundled deps export `draggable`, `dropTargetForElements`, `monitorForElements`, `combine` |

TypeScript resolution after install, confirming the split holds:

```
.                 -> 6.0.3   (what typescript-eslint loads)
apps/api          -> 7.0.2
apps/frontend     -> 7.0.2
packages/shared   -> 7.0.2
```

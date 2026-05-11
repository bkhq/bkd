# PLAN-006 Upgrade launcher Bun runtime

- **status**: completed
- **createdAt**: 2026-05-11 00:00
- **approvedAt**: 2026-05-11 00:00
- **relatedTask**: REL-001

## Context

The launcher is built by `.github/workflows/launcher.yml` through `bun scripts/compile.ts --mode launcher --target ...`. The compile script runs `bun build scripts/launcher.ts --compile`, so each launcher binary embeds the Bun runtime from the workflow's installed `bun`.

The current `launcher-v1` release was published on 2026-03-11. Its assets were built before Bun `1.3.13` was released. The workflow currently uses `oven-sh/setup-bun@v2` without `bun-version`, so rebuilding today should use the latest setup-bun stable runtime, but the intended runtime is not recorded or pinned in repository configuration.

The app package release workflow also uses setup-bun without a pinned version. That affects package bundling, but not the one-time launcher runtime already downloaded by users.

`docs/changelog.md` is missing, although PMA expects it to exist. This plan does not create it unless approved as part of record keeping.

## Proposal

Make the Bun runtime used by CI, package release, and launcher release workflows explicit by asking `setup-bun` for `latest`, then rebuild `launcher-v1` from `main`.

Implementation steps:

1. Pass `bun-version: latest` to each `oven-sh/setup-bun@v2` step.
2. Do not add a repository-local `.bun-version`; the launcher runtime should come from the workflow's Bun setup step.
3. Add `bun --version` output to the launcher build workflow so the rebuilt launcher release logs record the runtime version used.
4. Run focused validation:
   - `bun --version`
   - `bun scripts/compile.ts --mode launcher --target bun-linux-x64 --outfile bkd-launcher-linux-x64-test`
   - `gh workflow run launcher.yml --ref main` after the code change is on `main`, if release publication is part of the approved scope.

## Risks

- Rebuilding `launcher-v1` force-updates an existing release/tag by design. Existing download URLs remain stable, but asset checksums and upload timestamps change.
- Using `latest` keeps workflow rebuilds on the current Bun runtime, but it is less reproducible than a pinned version.
- Cross-compiling all launcher targets is done in GitHub Actions; local verification can cover one target only unless all targets are explicitly requested.

## Scope

Expected repository changes are limited to GitHub workflow YAML files and PMA tracking docs. No application runtime code changes are expected.

Release publication is a separate remote operation after the code change is merged or already present on `main`.

## Alternatives

- Re-run the existing launcher workflow without code changes. This is the smallest operational step, but it keeps the Bun version implicit and does not document which runtime was intended.
- Pin through `.bun-version`. This improves reproducibility, but it is not the right fit for this launcher because Bun is the embedded runtime being refreshed by the workflow.
- Change `launcher-v1` to `launcher-v2`. This avoids mutating the existing release, but it requires README/release link updates and changes the documented one-time download URL.

## Annotations

- 2026-05-11: User confirmed the current Bun installation is already `1.3.13`; the remaining upgrade target is the distributed launcher release asset, not the local Bun install.
- 2026-05-11: User approved option 2 and clarified that future Bun runtime changes should happen through regular version updates.
- 2026-05-11: Local implementation and verification passed. Remote `launcher-v1` rebuild is intentionally pending until these workflow changes exist on `main`.
- 2026-05-11: User corrected the approach: because Bun is the launcher runtime, workflow should request `latest` instead of pinning to a local version file.
- 2026-05-11: Commit `0a2b3ab` was pushed to `main`; launcher workflow run `25651691265` completed successfully and updated `launcher-v1`.

# PIPE-002 Release workflow 升级到 Node 24 兼容 actions

- **status**: completed
- **priority**: P1
- **owner**: local
- **created**: 2026-03-12

## Problem

GitHub Actions emitted a deprecation warning in the `Create Release` job because `actions/download-artifact@v4` and `softprops/action-gh-release@v2` are running on Node.js 20. GitHub will switch JavaScript actions to Node.js 24 by default on 2026-06-02.

The same workflow also uses `actions/upload-artifact@v4`, which is likewise still on Node.js 20 and should be upgraded at the same time.

## Solution

1. Upgrade GitHub-maintained actions to Node 24-compatible majors.
2. Replace `oven-sh/setup-bun@v2` with shell-based Bun installation because the latest published action still runs on Node 20.
3. Leave `softprops/action-gh-release@v2` unchanged for now and keep the workflow behavior intact.

## Files Changed

- `.github/workflows/release.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/launcher.yml`

## Follow-up

After retagging `v0.0.25`, the first workflow run failed in `Prepare assets` because the `download-artifact@v8` step no longer matched the path assumptions used by the release job. The workflow was updated to download the named artifact into `artifacts/bkd-app-package`, which matches the later copy step exactly.

Remaining Node 20 warnings in Actions were then removed by upgrading `actions/checkout` and `actions/cache`, and by replacing `oven-sh/setup-bun` with a shell install step across all workflows that build with Bun.

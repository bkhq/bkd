# 20261024-1500-upgrade-panel-lode-version Show the lode version and simplify the upgrade panel

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-10-24 15:00

## Description

The settings upgrade panel, under lode:

1. Should show lode's own version.
2. Shows lode's failure notes ("Last attempt failed: update check: manifest: release
   "0.3.27" has no assets", check failed, check timed out) and a raw status badge. These
   go; the panel only says "a new version is available" (with Update) or "up to date"
   (no Update button).

## ActiveForm

Simplifying the upgrade panel

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261024-1500-upgrade-panel-lode-version.md

- complete: bun run check passed (988 API, 396 frontend tests).

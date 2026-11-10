# 20261110-1217-agent-cli-update Update agent CLIs (claude, codex) from Settings

- **status**: completed
- **priority**: P2
- **owner**: claude/session-bkd
- **createdAt**: 2026-11-10 12:17

## Description

Add an "Update" action to each engine card in Settings -> Models for Claude Code and Codex. It runs the CLI's own
updater (`claude update`, `codex update`), shows its output, and refreshes the engine's version afterwards.

Acceptance: the button exists only for engines with an updater; one update runs at a time; output and the result
(old -> new version, or failure) are visible; the cached engine version reflects the update without a full probe.

## ActiveForm

Adding agent CLI updates to Settings

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261110-1217-agent-cli-update](../plan/20261110-1217-agent-cli-update.md)

- complete: Implemented; bun run check passes

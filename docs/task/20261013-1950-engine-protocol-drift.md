# 20261013-1950-engine-protocol-drift Fix Claude and Codex wire-protocol drift

- **status**: completed
- **priority**: P1
- **owner**: main/protocol-drift-20261013
- **createdAt**: 2026-10-13 19:50

## Description

A replay of real turns (Claude Code stream-json, Codex app-server 0.162.1)
through the BKD normalizers showed fields BKD reads that no longer exist on the
wire, and one accounting error.

Acceptance criteria:

- Claude: an issue's `totalCostUsd` grows by the real spend when one process
  emits several `result` lines; `total_cost_usd` is cumulative per process.
- Claude: the empty `result` that follows a task notification (`num_turns: 0`,
  `origin.kind: "task-notification"`) still completes the turn but renders no
  chat line.
- Claude: `rate_limit_event` is recognised; only a `rejected` status shows
  "Rate limit reached".
- Codex: `turn/started` updates the tracked turn id from `params.turn.id`.
- Codex: `thread/started` metadata carries `params.thread.id`.
- Codex: command display and classification use the bare command, not the
  `/usr/bin/bash -c '...'` wrapper.
- Each item has a regression test built from the captured wire shape.

Out of scope (follow-up tasks if wanted): `session_state_changed` opt-in env,
model list from the `initialize` response, SessionStart hook noise, new Codex
server requests and notifications, `thread/compacted` duplication.

## ActiveForm

Fixing Claude and Codex wire-protocol drift

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261013-1950-engine-protocol-drift.md`.

- complete: Focused suites and a replay of the captured wire traces pass; the full API suite has one failure (api-execution auto-execute timeout) that also fails on the untouched baseline.

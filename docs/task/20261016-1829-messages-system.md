# 20261016-1829-messages-system Upgrade decision events into a messages system

- **status**: completed
- **priority**: P2
- **owner**: claude/messages-system
- **createdAt**: 2026-10-16 18:29

## Description

Generalize the decision-event module into a messages system. A message has a
kind: `decision` (today's decision event, unchanged lifecycle) and
`notification` (one-way, agent-initiated). Agents can push messages out through
the existing webhook / Telegram channels, and the user sees all of them in one
inbox. The existing decision contract must keep working during the transition.

Acceptance criteria: see plan `20261016-1829-messages-system`.

## ActiveForm

Upgrading decision events into a messages system

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: [20261016-1829-messages-system](../plan/20261016-1829-messages-system.md)

- complete: Backend, frontend and docs done; API 923/924 (known api-execution flake), frontend 285/285, lint/typecheck/build clean; migration smoke-tested on a copy of the dev DB.

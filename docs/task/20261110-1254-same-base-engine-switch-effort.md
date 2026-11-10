# 20261110-1254-same-base-engine-switch-effort Switch between engines sharing a base engine, and pass effort

- **status**: completed
- **priority**: P2
- **owner**: claude/session-effort
- **createdAt**: 2026-11-10 12:54

## Description

An issue is bound to the engine it first executed with. A virtual engine and its base engine (for example
`claude-fable-5-2-high` and `claude-code`) run the same CLI and can resume the same session, so an issue should be
able to move between them on a follow-up or through issue PATCH. A switch to an engine with a different base engine
stays rejected. Separately, the reasoning effort (`low` / `medium` / `high` / `xhigh` / `max`) should be selectable
per issue and passed to the CLI, instead of needing one virtual engine per level.

Acceptance:
- Follow-up and PATCH accept `engineType` (real or virtual id); same base engine -> `engineProfileId` updated and the
  next turn runs with the new profile's env vars on the same session; different base -> 400; while running -> 409.
- Execute, follow-up and PATCH accept `effort`; it is persisted on the issue and the claude-code executor passes it to
  the CLI, overriding a profile's `CLAUDE_CODE_EFFORT_LEVEL`. Other engines ignore it.
- A changed engine profile, model or effort never reuses an idle live process.
- ChatInput lets the user pick engine + model among same-base engines and pick the effort for claude-code engines.

## ActiveForm

Adding same-base engine switching and per-issue effort

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261110-1254-same-base-engine-switch-effort.

- complete: API 1054 pass, frontend 397 pass, lint and build clean; typecheck clean apart from AppSettingsDialog.tsx edits of task 20261110-1259-model-configs in progress.

# 20261002-1111-persist-permission-mode Persist the issue permission mode

- **status**: completed
- **createdAt**: 2026-10-02 11:11
- **approvedAt**: 2026-10-02 11:11
- **relatedTask**: 20261002-1111-persist-permission-mode

## Context

- `CreateIssueSchema`, `ExecuteIssueSchema` and `FollowUpSchema` accept
  `permissionMode`; the `issues` table has no column for it.
- `getPermissionOptions(engineType, override)` falls back to
  `BUILT_IN_PROFILES[engine].permissionPolicy`, which is `auto` for all four
  engines.
- Callers with no override: `spawnRetry`, `restartIssue`, the pending flush
  (`routes/issues/_shared.ts` `flushPendingAsFollowUp`,
  `lifecycle/turn-completion.ts`), and `triggerIssueExecution` from the PATCH
  routes (status moved to `working`). An issue created in `todo` with
  `permissionMode: plan` loses the mode entirely.
- The chat input sends the mode with every follow-up, so "last explicit choice"
  is the natural stored value.

## Proposal

1. Schema: `issues.permission_mode` (nullable text), migration generated with
   `bun run db:generate`.
2. `engine-store.ts`: expose it in `IssueSessionFields` and accept it in
   `updateIssueSession`.
3. Write: issue create stores `body.permissionMode`; `executeIssue` and
   `followUpIssue` store an explicit mode when one is passed; duplicate copies
   the source issue's mode.
4. Read: execute, follow-up spawn, retry and restart resolve
   `explicit ?? stored ?? engine default`.

## Tests (RED first)

`test/permission-mode-persist.test.ts` with a recording executor:

- Create with `plan` in `todo`, execute without a mode: spawned with `plan`.
- Restart after a failure keeps the mode.
- A follow-up with `supervised` replaces the stored mode; a later follow-up
  without a mode and a restart use `supervised`.

## Risks

- Existing issues have `NULL` and keep today's behavior (engine default).
- Migration is additive (one nullable column).

## Scope

`db/schema.ts` + generated migration, `engine-store.ts`,
`routes/issues/create.ts`, `routes/issues/duplicate.ts`,
`orchestration/execute.ts`, `orchestration/follow-up.ts`,
`orchestration/restart.ts`, `lifecycle/spawn.ts`, one new test file, changelog.
The mode is not added to the issue API response.

## Alternatives

- Carry the mode only in memory on `ManagedProcess`. Rejected: restart and the
  status-triggered execute run with no process to read it from.

## Annotations

(none)

# 20261111-1734-dedupe-redundant-code Remove duplicated implementations and dead code found by the redundancy audit

- **status**: completed
- **createdAt**: 2026-11-11 17:34
- **approvedAt**: 2026-11-11 17:34
- **relatedTask**: 20261111-1734-dedupe-redundant-code

## Context

Audit of `3bbabc6` (jscpd, knip, manual tracing):

- First execution is assembled in three places: the execute route (`routes/issues/command.ts`),
  `triggerIssueExecution()` (`routes/issues/_shared.ts`) and the `issue-execute` cron action. The cron copy does not
  create the directory and does not resolve virtual engines. The cron follow-up bypasses `dispatchFollowUp()`.
- The workspace-boundary check (SEC-016) is copied into `command.ts`, `_shared.ts`, the cron action, `routes/git.ts`
  and twice into `routes/filesystem.ts`.
- Git change stats are computed by `routes/issues/changes.ts` and again by `events/changes-summary.ts`.
- Worktrees on disk are scanned and removed by both `routes/settings/cleanup.ts` and the `worktree-cleanup` builtin.
- Telegram `sendMessage` and HTML escaping exist in `webhooks/dispatcher.ts` and in `messages/telegram/`.
- Dead: `store/message-rebuilder.ts` (test-only), the query half of `ExecutionStore`, `utils/ring-buffer.ts`, four
  barrels under `engines/issue/`, the pid-lock upgrade token, unused frontend hooks / selectors / `ui/combobox.tsx`,
  dependencies `bs58`, `@hono/zod-validator`, `eslint-plugin-react-hooks`, and one-off probes under `tools/`,
  `scripts/pty-feasibility/`, `upgrade/`.
- Copied blocks: `export.ts` vs `persistence/queries.ts` row mapping; `normalizer-tool.ts` vs `tool-detail.ts` action
  parsing; six drawer stores; list/panel width logic in `IssueDetailPage` and `ReviewPage`; project form fields in
  `CreateProjectDialog` and `ProjectSettingsDialog`; the issue title header in `IssuePanel` and `ChatArea`; status
  constants in the API and the frontend.

## Proposal

1. `utils/workspace.ts`: one `isInsideWorkspace(dir)`; every SEC-016 site calls it.
2. One `startIssueExecution()` used by the execute route and the cron action; `triggerIssueExecution()` shares the
   working-directory preparation. Cron follow-up goes through `dispatchFollowUp()`.
3. `utils/changes.ts` owns listing and counting changes; the route and the SSE watcher both call it.
4. Worktree scan and removal live next to the worktree helpers; the settings route and the builtin pass their own
   "cleanable" predicate.
5. The webhook dispatcher sends through `messages/telegram/client.ts` and uses its escaping.
6. Delete the dead code above. `ExecutionStore` becomes the array it is used as.
7. Share the copied blocks: row mapping, tool action parsing, a drawer store factory, a list/panel layout hook, a
   project form fields component, an issue title header component, statuses in `@bkd/shared`.

## Risks

- Cron `issue-execute` now creates a missing project directory and accepts virtual engine ids, as the route does.
- Removing dependencies changes `bun.lock`.
- UI extractions are covered by existing component tests only where those exist; verify the rest in the browser.

## Scope

Out: the vendored `fm/` trees, the v1 `/api/decisions` contract, the per-engine normalizers, and every documented
REST route (`/changes/file` and `/issues/:id/terminate` stay; only their unused frontend callers go).

## Verification

`bun run check`; focused suites for each backend step; a browser pass over the drawers, the issue and review pages,
and both project dialogs.

## Outcome

Implemented as proposed, with these differences:

- The cron `issue-follow-up` action still calls the engine directly. `dispatchFollowUp()` queues a message for a
  `todo` / `done` issue where the action fails today, and a failing job is what auto-pauses it.
- Only the task-plan item parsing is shared between `normalizer-tool.ts` and `tool-detail.ts`; the agent and
  user-question blocks read different key names (CLI input vs stored action).
- `upgrade/fixdb-01.*` was first kept as an operator repair script for v0.0.7–v0.0.22 databases, then deleted on
  the user's confirmation that no install of those versions remains.
- The mobile menus in `HomePage` and `MobileSidebar` stay separate (different sizes, badge and active state).
- `git status` is now parsed with `-z`, so paths git would quote (spaces, non-ASCII) match their line counts.
- A Telegram webhook delivery records Telegram's `description` (or `ok`) as its response instead of the raw body.

Verified: `bun run lint` (2 warnings that predate this work), `bun run typecheck`, `bun run test` (API 1044 pass,
frontend 395 pass), `bun run db:generate` (no drift), `bun run build`, `bun install --frozen-lockfile`, and a
headless browser pass over home, board, issue, review, the messages drawer and the create-project dialog with no
page errors.

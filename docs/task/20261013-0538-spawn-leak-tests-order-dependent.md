# 20261013-0538-spawn-leak-tests-order-dependent Fix engine-spawn-leak concurrency tests that time out in the full suite

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-13 05:38

## Description

The six `concurrency limit already full` / `concurrency limit filled while spawning` cases in `test/engine-spawn-leak.test.ts` pass alone but time out (5s) when run after the other test files, on a clean tree too. Likely leftover processes or concurrency slots from earlier files.

Acceptance: the cases pass in the full `bun run test:api` run.

## ActiveForm

Fixing order-dependent spawn-leak tests.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Found while verifying `20261013-0244-worktree-cleanup-on-delete`.

## Findings (2026-10-15)

- Root cause: `test/preload.ts` mocks only the `codex` executor. Tests that move an
  issue to `working` without an engine (e.g. `api-issues.test.ts` "updates issue
  status", "bulk updates multiple issues") execute on the default `claude-code`
  engine, which spawns the real CLI: `/root/.local/bin/claude -p --output-format=stream-json
  ... --model claude-sonnet-5-5` with cwd at the repository root. Those processes stay
  `running` in the shared `issueEngine` process manager, so the spawn-leak
  `beforeEach` (waits for `activeCount() === 0`) hits bun's 5s hook timeout.
- CI has no `claude` binary, so the spawn fails fast there and the suite passes.
- The same leak plausibly explains `api-execution` "Concurrency limit reached (5/5)"
  (`20260922-1712`, `20261002-1046`, `20261013-2222`).
- Experiment: replacing only `spawn` / `spawnFollowUp` of the registered
  `claude-code` executor with the existing mock process gives 913 pass / 0 fail
  (was 907 / 6). Mocking the whole executor broke two `resolveExecutionModel`
  tests that read its static model catalog.

## Resolution

`test/preload.ts` wraps `spawnNode` / `runCommand` from `@/engines/spawn` and throws for
engine CLIs (`claude`, `codex`, `grok`, `cursor-agent`, `agent`, or the
`@anthropic-ai/claude-code` / `@openai/codex` npx packages). Every executor, the startup
probe and slash-command discovery spawn through those helpers, so a blocked spawn fails the
way a missing binary does in CI. This replaces the proposed per-executor mock: one guard
covers all engines and all spawn paths (including `claude --version`, `claude auth status`
and `claude -p -- /` discovery). `test/no-real-engine-cli.test.ts` pins the guard.

Full API suite, twice: 917 pass / 0 fail each; no new Claude session files were created.

- complete: Engine CLIs blocked in the test preload; full API suite green twice

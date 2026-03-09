# PLAN-008 Replace all Bun.spawn with node:child_process

- **task**: SPAWN-001
- **status**: completed
- **owner**: claude
- **created**: 2026-03-09

## Context

PIPE-001 migrated only the Claude executor from `Bun.spawn` to `node:child_process` to fix a stdout pipe breakage bug. The existing `engines/spawn.ts` provides `spawnNode()` with a Bun-compatible interface. This plan extends that migration to all remaining `Bun.spawn` usage.

### Current Bun.spawn usage inventory (apps/api/src/)

| File | Calls | Pattern |
|------|-------|---------|
| `engines/executors/codex/executor.ts` | 5 | Long-lived + run-and-capture |
| `engines/executors/codex/protocol.ts` | 0 (type only) | `FileSink` stdin type |
| `engines/executors/gemini/executor.ts` | 3 | Run-and-capture |
| `engines/executors/echo/executor.ts` | 0 | Uses `Bun.sleep()` |
| `engines/process-manager.ts` | 0 (type only) | `import type { Subprocess } from 'bun'` |
| `engines/types.ts` | 0 (type only) | `type Subprocess = ReturnType<typeof Bun.spawn>` |
| `engines/command.ts` | 1 | `Bun.which()` |
| `engines/issue/utils/worktree.ts` | 4 | Run-and-capture git |
| `events/changes-summary.ts` | 1 | Run-and-capture git |
| `routes/git.ts` | 1 | Run-and-capture git |
| `routes/files.ts` | 1 | Run-and-capture git |
| `routes/issues/changes.ts` | 1 | Run-and-capture git |
| `routes/terminal.ts` | 2 | PTY (Bun.spawn) + sync (Bun.spawnSync) |
| `upgrade/apply.ts` | 3 | Run-and-capture + detached |
| `engines/process-manager.test.ts` | ~20 | Test helpers |

### Terminal PTY exception

`routes/terminal.ts` uses `Bun.spawn` with the `terminal` option (PTY support). This is a Bun-specific API with no Node.js equivalent without adding `node-pty`. **This file is excluded** from migration except for the `Bun.spawnSync` call in `getDefaultShell()`.

## Proposal

### Step 1: Extend spawn.ts with utilities

Add to `engines/spawn.ts`:
- `spawnNodeSync(cmd, options)` — wraps `child_process.spawnSync`, returns `{ exitCode, stdout, stderr }`
- `runCommand(cmd, options)` — convenience for run-and-capture pattern: spawns, reads stdout, awaits exit, returns `{ code, stdout }`
- Export a generic `Subprocess` interface (replacing `import type { Subprocess } from 'bun'`)

### Step 2: Update core types

- `engines/types.ts`: Replace `type Subprocess = ReturnType<typeof Bun.spawn>` with import from `spawn.ts`
- `engines/process-manager.ts`: Replace `import type { Subprocess } from 'bun'` with import from `spawn.ts`

### Step 3: Migrate engine executors

- **Codex executor**: Replace 5 `Bun.spawn` calls with `spawnNode()` / `runCommand()`
- **Codex protocol**: Replace `import type { FileSink } from 'bun'` with `StdinWriter` from `spawn.ts`
- **Gemini executor**: Replace 3 `Bun.spawn` calls with `spawnNode()` / `runCommand()`
- **Echo executor**: Replace `Bun.sleep()` with standard `setTimeout`-based promise
- **Command builder**: Replace `Bun.which()` with `node:child_process` `spawnSync('which', [program])`

### Step 4: Migrate git utility functions

All 4 `runGit()` variants + worktree.ts use the same pattern. Replace with `runCommand()`:
- `events/changes-summary.ts`
- `routes/git.ts`
- `routes/files.ts`
- `routes/issues/changes.ts`
- `engines/issue/utils/worktree.ts`

### Step 5: Migrate upgrade/apply.ts

Replace 3 `Bun.spawn` calls (tar extraction + 2 detached process spawns).

### Step 6: Migrate terminal.ts (partial)

Replace only `Bun.spawnSync` in `getDefaultShell()` with `spawnNodeSync()`. Keep `Bun.spawn` for PTY.

### Step 7: Migrate tests

- `engines/process-manager.test.ts`: Replace `Bun.spawn` helpers with `spawnNode()`

### Step 8: Verify

- Run `bun run test` (all workspaces)
- Run `bun run lint`
- Grep for remaining `Bun.spawn` — only terminal PTY should remain

## Risks

- **Terminal PTY**: Cannot be migrated without `node-pty` dependency. Explicitly excluded.
- **Bun.file()**: Used in codex/gemini executors for auth config checks — not in scope (not spawn-related).
- **Process group handling**: `spawnNode()` uses `detached: true` + `kill(-pid)`. Need to verify this works correctly for Codex/Gemini executors too.
- **AbortSignal.timeout**: `changes-summary.ts` uses `signal: AbortSignal.timeout(10_000)` with Bun.spawn. Node's child_process supports `signal` option via `AbortController` — need equivalent.

## Alternatives

1. **Keep hybrid** (status quo): Only Claude uses node:child_process, others stay on Bun.spawn. Risk: inconsistency, future pipe bugs in other executors.
2. **Full migration including PTY**: Add `node-pty` dependency. More complete but adds external dependency.
3. **Chosen approach**: Migrate everything except PTY terminal. Best balance of consistency vs. minimal dependencies.

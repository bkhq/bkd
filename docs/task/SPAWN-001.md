# SPAWN-001 Replace all Bun.spawn with node:child_process

- **priority**: P1
- **status**: completed
- **owner**: claude
- **plan**: PLAN-008
- **created**: 2026-03-09

## Description

Migrate all remaining `Bun.spawn` / `Bun.spawnSync` calls in the runtime app (`apps/api/src/`) to `node:child_process`, extending the pattern established by PIPE-001 (Claude executor migration).

The existing `engines/spawn.ts` wrapper (`spawnNode()`) already provides a Bun-compatible interface. This task extends that wrapper and applies it project-wide.

## Scope

- All `Bun.spawn` in `apps/api/src/` runtime code
- All `Bun.spawnSync` in `apps/api/src/` runtime code
- Related Bun type imports (`Subprocess`, `FileSink`)
- `Bun.which()` in command.ts
- Test files that use `Bun.spawn` directly

**Out of scope:**
- Build scripts (`scripts/`) — these run in Bun context by design
- Terminal PTY (`routes/terminal.ts`) — uses Bun-specific `terminal` option, requires `node-pty` for migration (separate task)

## Acceptance criteria

- [ ] Zero `Bun.spawn` / `Bun.spawnSync` in `apps/api/src/` except terminal PTY
- [ ] All existing tests pass
- [ ] No new dependencies added (uses only `node:child_process`)
- [ ] `ProcessManager` and `types.ts` use generic subprocess type instead of `import type { Subprocess } from 'bun'`

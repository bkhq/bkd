# 20261106-0600-dev-hot-reload-pid-lock Dev API exits on hot reload: the pid lock treats its own pid as another instance

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-11-06 06:00

## Description

`bun run dev:api` runs `bun --hot src/index.ts`. When an edit makes Bun re-evaluate `server-main.ts` in the same
process, `acquirePidLock()` finds `data/bkd.pid` holding the current pid, logs
`pid_lock_failed_another_instance_running` (`existingPid` = own pid) and `exitDuplicateInstance()` ends the
process, so the dev API dies after a backend edit (seen 2026-11-06 after editing `routes/fm.ts`). The pid lock
should accept its own pid, or not run again on hot reload.

## ActiveForm

Keeping the dev API alive across hot reloads

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)

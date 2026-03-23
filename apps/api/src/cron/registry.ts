import { runUploadCleanup } from './tasks/upload-cleanup'
import { runWorktreeCleanup } from './tasks/worktree-cleanup'

export type BuiltinHandler = () => Promise<string>

const builtinHandlers = new Map<string, BuiltinHandler>([
  ['upload-cleanup', runUploadCleanup],
  ['worktree-cleanup', runWorktreeCleanup],
])

export function getBuiltinHandler(name: string): BuiltinHandler | undefined {
  return builtinHandlers.get(name)
}

export function getBuiltinNames(): string[] {
  return [...builtinHandlers.keys()]
}

# PLAN-003 Migrate claude executor to @anthropic-ai/claude-agent-sdk

- **status**: steps 1-3 complete; awaiting production soak before step 4
- **createdAt**: 2026-04-17
- **approvedAt**: 2026-04-17
- **relatedTask**: ENG-001

## Progress

- Step 1 (POC + scaffold) — done: `apps/api/src/engines/executors/claude-sdk/`
  (executor, normalizer wrapper, handle, pushable stream). SDK dep added at
  `~0.2.113`.
- Step 2 (PM abstraction) — done: `engines/process-handle.ts` + PM narrowed
  from `Subprocess` to `ProcessHandle`; terminal.ts migrated to store PTY
  subprocess in `meta.pty`.
- Step 3 (env flag + tests) — done: `CLAUDE_ENGINE_BACKEND=sdk|legacy`
  (default `legacy`). Test suite in `apps/api/test/claude-sdk.test.ts`
  covers PushableStream / SdkProcessHandle / normalizer / backend select.
  Full `bun test` green (495 pass).
- Steps 4 + 5 pending: flip default, then delete `claude/` + collapse
  normalizer to typed SDK input.

## Context

The `claude-code` engine integration predates the public Claude Agent SDK. It
spawns the `claude` CLI with stream-json I/O and hand-rolls the bidirectional
control protocol end-to-end. Anthropic now ships an official TypeScript SDK
(`@anthropic-ai/claude-agent-sdk`, v0.2.113, lock-step with CLI `2.1.112`)
that wraps the same subprocess + control protocol behind a typed async
generator API.

### Current surface (to be replaced)

| File | Lines | Role |
|---|---|---|
| `apps/api/src/engines/executors/claude/executor.ts` | 538 | Binary discovery, `CommandBuilder` flags, spawn, SDK-init handshake (`initialize` + `set_permission_mode` + `sendUserMessage`), slash-command discovery, static model list |
| `apps/api/src/engines/executors/claude/protocol.ts` | 415 | stdin writer + stdout filter; parses `control_request` (`can_use_tool`, `hook_callback`), auto-approves tools, routes `ExitPlanMode` to a `setMode` permission update, `interrupt` / `set_permission_mode` control messages |
| `apps/api/src/engines/executors/claude/normalizer.ts` | 712 | Parses raw stream-json lines into `NormalizedLogEntry` |
| `apps/api/src/engines/executors/claude/normalizer-tool.ts` | 208 | Tool-use classification |
| `apps/api/src/engines/executors/claude/normalizer-types.ts` | 235 | Type definitions for raw stream-json shapes |
| **Total** | **~2108** | |

### Downstream consumers

- `SpawnedProcess` (`engines/types.ts:129`) is consumed by
  - `ProcessManager` (`engines/process-manager.ts`, 500 L) — needs a Bun `Subprocess` handle
  - `consumeStream` (`engines/issue/streams/consumer.ts:59`) — consumes `ReadableStream<Uint8Array>` with a line parser
  - `spawn.ts` (`engines/issue/lifecycle/spawn.ts`) — constructs `SpawnedProcess`
  - `reconciler.ts`, `startup-probe.ts` — probe and cleanup
- `ClaudeLogNormalizer` is used by the executor itself and re-exported from `executors/claude/index.ts`

### SDK capability matrix

| Current hand-rolled behavior | Claude Agent SDK equivalent |
|---|---|
| Spawn `claude -p --output-format=stream-json --input-format=stream-json` | `query({ prompt, options })` — SDK spawns the binary internally |
| `initialize` control handshake | Implicit on first `query()` invocation |
| `set_permission_mode` control message | `options.permissionMode` + `Query.setPermissionMode()` at runtime |
| `can_use_tool` auto-approval | `options.canUseTool(toolName, input)` callback |
| `hook_callback` routing (PreToolUse etc.) | `options.hooks` (typed `HookCallbackMatcher[]`) |
| ExitPlanMode → `setMode` permission patch | `canUseTool` return value may include `updatedPermissions` |
| `--resume <sessionId>` / `--resume-session-at <uuid>` | `options.resume`, `options.resumeSessionAt` |
| `--session-id` for externally-injected session | `options.extraArgs: { 'session-id': id }` |
| `--agent <name>` | `options.agents` or `options.extraArgs` |
| `sendUserMessage` over stdin (stream-json) | `prompt: AsyncIterable<SDKUserMessage>` + `yield` |
| `interrupt` control request | `Query.interrupt()` |
| `--disallowedTools AskUserQuestion` | `options.disallowedTools` |
| `--debug --debug-file <path>` | `options.extraArgs: { debug: null, 'debug-file': path }` |
| Slash-command discovery via one-shot `--max-turns 1 -- /` | `Query.supportedCommands()` |
| Static `CLAUDE_MODELS` list | `Query.supportedModels()` |
| Binary path resolution (`/work/bin/claude` → `$HOME` → `/usr/local/bin` → npx fallback) | `options.pathToClaudeCodeExecutable` (keep the discovery helper, **drop npx fallback** for SDK backend) |
| stream-json line parsing → `NormalizedLogEntry` | Normalize typed `SDKMessage` instead of raw strings — far fewer field probes |

## Proposal

### Step 1 — Add SDK dependency + parallel executor (POC, no code churn elsewhere)

- Add `@anthropic-ai/claude-agent-sdk@~0.2.113` to `apps/api/package.json`
- Create `apps/api/src/engines/executors/claude-sdk/` with:
  - `executor.ts` — implements `EngineExecutor` for `claude-code`, uses `query()`
  - `normalizer.ts` — temporary thin wrapper that JSON-stringifies `SDKMessage` and feeds it to the existing `ClaudeLogNormalizer` (so we defer normalizer rewrite to Step 3)
  - `index.ts` — exports
- **Not wired into the registry yet** — POC runs via a one-off script / bun test.
- Verify against a real issue end-to-end: `spawn` → emit 3 log entries → cancel → followup → completion. No DB writes in POC (use a recording harness).

**Files**: `apps/api/package.json`, `apps/api/src/engines/executors/claude-sdk/*` (new), `apps/api/scripts/sdk-poc.ts` (new, ephemeral)

**Exit criteria**: POC harness completes `spawn → user msg → assistant text → tool use → result` without errors, and `Query.interrupt()` settles the session cleanly.

### Step 2 — Generalize ProcessManager to handle-based abstraction

Observation: `ProcessManager` only consumes three members of the `Subprocess` type (see `process-manager.ts:172,187,177,219,221`):
- `subprocess.kill(signal)` — force-kill (SIGKILL path after `killTimeoutMs`)
- `subprocess.exited` — Promise<number> awaited during terminate
- `subprocess.pid` — logging only

Everything else (`stdin`, `stdout`, `stderr`) is consumed by `consumeStream` and the protocol handler **independently** of PM. This means PM's dependency on Bun's `Subprocess` is a historical accident, not a structural one.

**Solution**: introduce a minimal `ProcessHandle` interface that PM manages, and let each engine's executor provide its own concrete handle.

```typescript
// engines/process-handle.ts (new)
export interface ProcessHandle {
  readonly pid?: number
  readonly exited: Promise<number>
  kill(signal?: number): void
}
```

**Bun subprocess handle** — implicit, since `Bun.Subprocess` already matches this shape. Existing Codex / ACP / legacy-Claude executors pass their `subprocess` directly with zero change.

**SDK Query handle** — a ~30 L wrapper living in `executors/claude-sdk/handle.ts`:
- `kill(signal)` → `Query.interrupt()` (signal ignored; SDK has one interrupt path). After `killTimeoutMs` PM triggers this a second time as SIGKILL-equivalent; we gate to no-op on second call.
- `exited` → a Promise resolved by the executor when the async generator for-await loop finishes (either normal `result` message, thrown error, or post-interrupt settle). Resolve value is `0` for normal end, non-zero when SDK surfaces an error.
- `pid` → undefined (SDK doesn't expose the child PID; acceptable since it's logging-only).

**PM changes** (single file, `process-manager.ts`):
- Rename `subprocess: Subprocess` → `handle: ProcessHandle` on `ManagedEntry` (keep `subprocess` as a deprecated getter alias for one cycle if necessary for external callers — audit shows only `reconciler.ts` reads `managed.subprocess.pid`, trivial to rewrite).
- Replace `entry.subprocess.kill(9)` with `entry.handle.kill(9)` in 2 places.
- Replace `entry.subprocess.exited` with `entry.handle.exited` in 1 place.
- Replace `(entry.subprocess as { pid?: number }).pid` with `entry.handle.pid` in 2 places.

**Stream side** (`consumeStream`): still accepts `ReadableStream<Uint8Array>`. The SDK executor synthesizes one from the async generator by emitting `JSON.stringify(sdkMessage) + '\n'`. This is a *temporary* bridge — Step 5 replaces it with direct `AsyncIterable<SDKMessage>` consumption in a typed normalizer. During the side-by-side period, the string round-trip cost is negligible (these are already JSON-serialized over stdout in the legacy path).

**Why this is better than the earlier "shim" proposal**: The shim fakes a `Subprocess`. The handle abstraction is the honest, minimal contract; narrower type surface, no fake Bun-specific fields to maintain, and the mental model ("PM manages lifecycle, not I/O") becomes the file-level comment.

**Scope of files touched in Step 2**:
- `apps/api/src/engines/process-handle.ts` (new, ~15 L)
- `apps/api/src/engines/process-manager.ts` (rename field + 5 call sites)
- `apps/api/src/engines/types.ts` — `SpawnedProcess.subprocess: Subprocess` stays (still the I/O wrapper that executors return) **but** `ManagedProcess` in `issue/types.ts` starts using `handle` instead
- `apps/api/src/engines/issue/types.ts` — `ManagedProcess.subprocess` → `handle`
- `apps/api/src/engines/reconciler.ts` — 1 logging line
- `apps/api/src/engines/executors/claude-sdk/handle.ts` (new, ~30 L)
- `apps/api/src/engines/executors/claude-sdk/executor.ts` — implements `spawn` / `spawnFollowUp` returning `SpawnedProcess` whose `subprocess` is the SDK handle (cast OK since PM only reads through `ProcessHandle`)

All legacy Codex/ACP executors are untouched because `Bun.Subprocess` already satisfies `ProcessHandle` structurally.

**Regression risk**: very low; it's a mechanical narrowing of a type dependency with 5 call-site edits. The generic parameter `TMeta` stays as-is, so every existing registration call compiles unchanged.

### Step 3 — Wire behind `CLAUDE_ENGINE_BACKEND` env flag, side-by-side

- Register the SDK executor in `apps/api/src/engines/executors/index.ts`:
  - `CLAUDE_ENGINE_BACKEND=sdk` → `ClaudeCodeSdkExecutor`
  - `CLAUDE_ENGINE_BACKEND=legacy` (default during rollout) → existing `ClaudeCodeExecutor`
- `startup-probe.ts` must not probe both — pick one backend and report its version
- Add smoke-test coverage in `apps/api/test/` for the SDK path: spawn, followup, cancel, resume-at-message

**Files**: `engines/executors/index.ts`, `engines/startup-probe.ts`, `apps/api/test/engines/claude-sdk.test.ts` (new)

### Step 4 — Flip default to SDK

- Default `CLAUDE_ENGINE_BACKEND` to `sdk`
- Keep legacy executor + files in the tree, guarded by the flag
- Run at least one release cycle in production before Step 5
- Update `CLAUDE.md` engine section to document the flag

**Files**: `engines/executors/index.ts` (default), `CLAUDE.md` (docs)

### Step 5 — Collapse normalizer to typed input, delete legacy

- Rewrite `executors/claude-sdk/normalizer.ts` to consume `SDKMessage` directly (no string → JSON round-trip)
- Delete:
  - `executors/claude/` in its entirety (~2100 L)
  - `engines/types.ts#SpawnedProcess.protocolHandler` field and its Subprocess coupling (if Option B is adopted)
  - `--permission-prompt-tool=stdio`, `--input-format`, `--output-format=stream-json` CLI plumbing in `CommandBuilder` usages specific to claude
- Remove the `CLAUDE_ENGINE_BACKEND` flag — only SDK remains

**Net diff estimate**: −1600 to −1800 L after all cleanup.

## Risks

1. **ProcessManager coupling** (§Step 2) — resolved by introducing a narrow `ProcessHandle` interface (`{ pid?, exited, kill }`). Audit of `process-manager.ts` confirmed only 5 call sites touch the subprocess; `Bun.Subprocess` structurally satisfies the new interface so legacy executors need no changes. Claude-sdk executor provides a ~30 L handle wrapper around `Query.interrupt()` + generator-completion promise.
2. **Binary path contract** — SDK requires a real binary; existing fallback to `npx -y @anthropic-ai/claude-code` disappears for SDK backend. Mitigation: keep `resolveBinaryOnly()` helper, surface a clearer error when binary is missing (prompt user to `bun install -g @anthropic-ai/claude-code` or use the project's bundled binary).
3. **SDK ↔ CLI version drift** — SDK protocol is tied to the local `claude` binary. If a user's `/work/bin/claude` is older/newer than SDK's expected protocol version, handshake can fail silently. Mitigation: read `claude --version` at startup and compare to `@anthropic-ai/claude-agent-sdk` `package.json.version`; warn on mismatch; document the compatibility matrix.
4. **ExitPlanMode permission patch** — Current code returns `updatedPermissions: [{ type: 'setMode', mode: 'bypassPermissions' }]` from `can_use_tool`. Must verify SDK's `canUseTool` return type supports the same shape on the target version.
5. **Debug logging** — `--debug --debug-file` is currently enabled when `LOG_LEVEL=debug|trace`. Must confirm `extraArgs` passthrough works for these flags in the SDK's command assembly.
6. **Bun runtime** — SDK has `executable: 'bun' | 'deno' | 'node'`. Confirm that `executable: 'bun'` spawns `claude` correctly under Bun (the SDK itself is JS so the runtime choice affects how SDK handles its own child process, not the `claude` binary).
7. **Log-level parity** — `LOG_EXECUTOR_IO=1` currently dumps every stdin/stdout line via `protocol.ts`. The SDK hides protocol frames. We lose that debug surface unless we add an equivalent `includePartialMessages` + stderr callback pipeline.
8. **Session fork semantics** — `options.forkSession` exists on SDK and may interact differently with our `resetToMessageId` / `resumeSessionAt` flow. Verify with a test that reset-to-message behaves identically.
9. **Rollback** — Step 4 flip is a single env-var flip; Step 5 (deletion) is irreversible without git revert. Do not merge Step 5 until two weeks of SDK-default production stability.
10. **npm supply chain** — Adding a direct Anthropic SDK dependency affects `compile` bundle size. Measure before/after.

## Verification Plan

Per step:

- **Step 1**: POC harness script logs SDK messages for a real issue; manual inspection of message flow; compare against legacy executor output for the same prompt (diff should only be formatting).
- **Step 2/3**: `bun test:api` green; new `claude-sdk.test.ts` covers spawn/followup/cancel/resume-at-message. Manual smoke on dev server: create issue → run → cancel → followup.
- **Step 4**: Deploy with `CLAUDE_ENGINE_BACKEND=sdk` as default in dev; run the kanban UI for a full session; verify SSE log entries arrive identically to legacy.
- **Step 5**: Full `bun run test`, `bun run lint`, `bun run typecheck`. Measure `compile` binary size before/after.

## Out of Scope

- Codex (`executors/codex/`) and ACP (`executors/acp/`) executors. They use different protocols and will not be touched.
- Frontend changes. The normalized log entry shape is preserved.
- MCP server configuration surface changes (SDK's `mcpServers` option is richer than what we expose, but aligning is a follow-up task).

## Alternatives Considered

1. **Do nothing** — maintain ~2100 L of hand-rolled protocol. Cost: every CLI upgrade risks control-protocol drift; past incidents (`hook_callback` field-shape changes) required reverse-engineering. Rejected.
2. **Partial migration** — use SDK only for new capabilities (`supportedCommands`, `supportedModels`) while keeping hand-rolled spawn. Keeps two code paths permanently; rejected as a long-term state but acceptable as an intermediate (Step 1 essentially achieves this).
3. **Switch to the Anthropic HTTP SDK (`@anthropic-ai/sdk`)** — bypasses the `claude` binary entirely. Would lose Claude Code–specific features (slash commands, hooks, plugin discovery, session resume semantics, ExitPlanMode). Rejected — we explicitly want Claude Code behavior, not raw messages API.
